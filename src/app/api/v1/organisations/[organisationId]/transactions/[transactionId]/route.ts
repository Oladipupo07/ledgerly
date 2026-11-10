import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authenticatedUserId, apiError, apiFailure, isSameOrigin, isUuid, parsePositiveKobo, withUserContext } from "@/lib/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ organisationId: string; transactionId: string }> };

function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export async function PATCH(request: NextRequest, context: Context) {
  if (!isSameOrigin(request)) return apiError(403, "INVALID_ORIGIN", "Request origin could not be verified.");
  const userId = await authenticatedUserId();
  if (!userId) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
  const { organisationId, transactionId } = await context.params;
  if (!isUuid(transactionId)) return apiError(404, "TRANSACTION_NOT_FOUND", "Transaction not found.");
  const key = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) return apiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Provide a valid Idempotency-Key header.");

  let body: unknown;
  try { body = await request.json(); } catch { return apiError(400, "INVALID_JSON", "Provide a valid JSON request."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return apiError(400, "INVALID_INPUT", "Draft transaction updates are required.");
  const input = body as Record<string, unknown>;
  const allowed = new Set(["date", "description", "amountKobo", "categoryId", "trackingAccountId", "contactId", "reference", "notes", "attachmentName"]);
  if (Object.keys(input).length === 0 || Object.keys(input).some((field) => !allowed.has(field))) {
    return apiError(400, "UNKNOWN_FIELD", "Provide valid draft transaction fields to update.");
  }

  if (input.date !== undefined && !isDate(input.date)) return apiError(400, "INVALID_INPUT", "Provide a valid YYYY-MM-DD date.");
  if (input.description !== undefined && (typeof input.description !== "string" || !input.description.trim() || input.description.trim().length > 240)) {
    return apiError(400, "INVALID_INPUT", "Description must be 1 to 240 characters.");
  }
  if (input.amountKobo !== undefined && !parsePositiveKobo(input.amountKobo)) {
    return apiError(400, "INVALID_INPUT", "Provide a positive integer kobo amount.");
  }
  if (input.categoryId !== undefined && input.categoryId !== null && (typeof input.categoryId !== "string" || !isUuid(input.categoryId))) {
    return apiError(400, "INVALID_INPUT", "Provide a valid category ID.");
  }
  if (input.trackingAccountId !== undefined && (typeof input.trackingAccountId !== "string" || !isUuid(input.trackingAccountId))) {
    return apiError(400, "INVALID_INPUT", "Provide a valid tracking label ID.");
  }
  if (input.contactId !== undefined && input.contactId !== null && (typeof input.contactId !== "string" || !isUuid(input.contactId))) {
    return apiError(400, "INVALID_INPUT", "Provide a valid contact ID.");
  }
  if (input.reference !== undefined && input.reference !== null && (typeof input.reference !== "string" || input.reference.trim().length > 120)) {
    return apiError(400, "INVALID_INPUT", "Reference must be 120 characters or fewer.");
  }
  if (input.notes !== undefined && input.notes !== null && (typeof input.notes !== "string" || input.notes.trim().length > 2000)) {
    return apiError(400, "INVALID_INPUT", "Notes must be 2,000 characters or fewer.");
  }
  if (input.attachmentName !== undefined && input.attachmentName !== null && (typeof input.attachmentName !== "string" || input.attachmentName.trim().length > 200)) {
    return apiError(400, "INVALID_INPUT", "Attachment name must be 200 characters or fewer.");
  }

  const operation = `transaction.update_draft:${transactionId}`;
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  try {
    const outcome = await withUserContext(userId, organisationId, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${organisationId}:${operation}:${key}`]);
      const prior = await client.query(
        `SELECT request_hash, response_data FROM idempotency_records
          WHERE organisation_id = $1 AND operation = $2 AND idempotency_key = $3`,
        [organisationId, operation, key],
      );
      if (prior.rowCount) {
        return prior.rows[0].request_hash === hash
          ? { conflict: false as const, replayed: true, data: prior.rows[0].response_data }
          : { conflict: true as const };
      }

      const current = await client.query(
        `SELECT id, transaction_date::text AS date, description, type, status,
                amount_kobo::text AS "amountKobo", direction, category_id AS "categoryId",
                tracking_account_id AS "trackingAccountId", transfer_to_account_id AS "transferToAccountId",
                contact_id AS "contactId", reference, notes, attachment_name AS "attachmentName"
           FROM transactions WHERE organisation_id = $1 AND id = $2 FOR UPDATE`,
        [organisationId, transactionId],
      );
      if (!current.rowCount) return { missing: true as const };
      const existing = current.rows[0];
      if (existing.status !== "draft") return { immutable: true as const };

      const nextDate = typeof input.date === "string" ? input.date : existing.date;
      const nextDesc = typeof input.description === "string" ? input.description.trim() : existing.description;
      const nextAmount = input.amountKobo !== undefined ? parsePositiveKobo(input.amountKobo)!.toString() : existing.amountKobo;
      const nextCat = input.categoryId === undefined ? existing.categoryId : input.categoryId;
      const nextAcc = typeof input.trackingAccountId === "string" ? input.trackingAccountId : existing.trackingAccountId;
      const nextContact = input.contactId === undefined ? existing.contactId : input.contactId;
      const nextRef = input.reference === undefined ? existing.reference : (typeof input.reference === "string" && input.reference.trim() ? input.reference.trim() : null);
      const nextNotes = input.notes === undefined ? existing.notes : (typeof input.notes === "string" && input.notes.trim() ? input.notes.trim() : null);
      const nextAttachment = input.attachmentName === undefined ? existing.attachmentName : (typeof input.attachmentName === "string" && input.attachmentName.trim() ? input.attachmentName.trim() : null);

      const updated = await client.query(
        `UPDATE transactions
            SET transaction_date = $3::date,
                description = $4,
                amount_kobo = $5::bigint,
                category_id = $6,
                tracking_account_id = $7,
                contact_id = $8,
                reference = $9,
                notes = $10,
                attachment_name = $11,
                updated_at = now()
          WHERE organisation_id = $1 AND id = $2 AND status = 'draft'
          RETURNING id, transaction_date::text AS date, description, type, status,
                    amount_kobo::text AS "amountKobo", direction, category_id AS "categoryId",
                    tracking_account_id AS "trackingAccountId", transfer_to_account_id AS "transferToAccountId",
                    contact_id AS "contactId", reference, notes, attachment_name AS "attachmentName"`,
        [organisationId, transactionId, nextDate, nextDesc, nextAmount, nextCat, nextAcc, nextContact, nextRef, nextNotes, nextAttachment],
      );
      const data = updated.rows[0];
      await client.query(
        `INSERT INTO audit_events (organisation_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
         VALUES ($1, $2, 'transaction.draft_updated', 'transaction', $3, $4::jsonb, $5::jsonb)`,
        [organisationId, userId, transactionId, JSON.stringify(existing), JSON.stringify(data)],
      );
      await client.query(
        `INSERT INTO idempotency_records (organisation_id, operation, idempotency_key, request_hash, response_data)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [organisationId, operation, key, hash, JSON.stringify(data)],
      );
      return { conflict: false as const, replayed: false, data };
    }, "transaction:create_edit");

    if ("missing" in outcome) return apiError(404, "TRANSACTION_NOT_FOUND", "Transaction not found.");
    if ("immutable" in outcome) return apiError(409, "POSTED_TRANSACTION_IMMUTABLE", "Posted or reversed transactions cannot be edited; record an audited reversal instead.");
    if (outcome.conflict) return apiError(409, "IDEMPOTENCY_KEY_REUSED", "This idempotency key was used for a different draft transaction update.");
    return NextResponse.json({ data: outcome.data, replayed: outcome.replayed }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiFailure(error, "TRANSACTION_UPDATE_FAILED", "Could not update the draft transaction.");
  }
}

