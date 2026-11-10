import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authenticatedUserId, apiError, apiFailure, isSameOrigin, isUuid, withUserContext } from "@/lib/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ organisationId: string; billId: string }> };

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export async function PATCH(request: NextRequest, context: Context) {
  if (!isSameOrigin(request)) return apiError(403, "INVALID_ORIGIN", "Request origin could not be verified.");
  const userId = await authenticatedUserId();
  if (!userId) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
  const { organisationId, billId } = await context.params;
  if (!isUuid(billId)) return apiError(404, "BILL_NOT_FOUND", "Supplier bill not found.");
  const key = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) return apiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Provide a valid Idempotency-Key header.");

  let body: unknown;
  try { body = await request.json(); } catch { return apiError(400, "INVALID_JSON", "Provide a valid JSON request."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return apiError(400, "INVALID_INPUT", "Supplier bill updates are required.");
  const input = body as Record<string, unknown>;
  const allowed = new Set(["status", "dueDate", "notes", "attachmentName"]);
  if (Object.keys(input).length === 0 || Object.keys(input).some((field) => !allowed.has(field))) {
    return apiError(400, "UNKNOWN_FIELD", "Provide valid supplier bill fields to update.");
  }

  if (input.status !== undefined && input.status !== "cancelled" && input.status !== "open") {
    return apiError(400, "INVALID_INPUT", "Bill status update must be open or cancelled.");
  }
  if (input.dueDate !== undefined && !validDate(input.dueDate)) {
    return apiError(400, "INVALID_INPUT", "Provide a valid YYYY-MM-DD due date.");
  }
  if (input.notes !== undefined && input.notes !== null && (typeof input.notes !== "string" || input.notes.trim().length > 2000)) {
    return apiError(400, "INVALID_INPUT", "Notes must be 2,000 characters or fewer.");
  }
  if (input.attachmentName !== undefined && input.attachmentName !== null && (typeof input.attachmentName !== "string" || input.attachmentName.trim().length > 200)) {
    return apiError(400, "INVALID_INPUT", "Attachment name must be 200 characters or fewer.");
  }

  const operation = `supplier-bill.update:${billId}`;
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
        `SELECT id, bill_number AS "billNumber", status, bill_date::text AS "billDate",
                due_date::text AS "dueDate", paid_amount_kobo::text AS "paidAmountKobo",
                notes, attachment_name AS "attachmentName"
           FROM supplier_bills WHERE organisation_id = $1 AND id = $2 FOR UPDATE`,
        [organisationId, billId],
      );
      if (!current.rowCount) return { missing: true as const };
      const existing = current.rows[0];

      if (input.status === "cancelled" && BigInt(existing.paidAmountKobo) > 0n) {
        return { hasPayments: true as const };
      }

      const nextStatus = typeof input.status === "string" ? input.status : existing.status;
      const nextDueDate = typeof input.dueDate === "string" ? input.dueDate : existing.dueDate;
      const nextNotes = input.notes === undefined ? existing.notes : (typeof input.notes === "string" && input.notes.trim() ? input.notes.trim() : null);
      const nextAttachment = input.attachmentName === undefined ? existing.attachmentName : (typeof input.attachmentName === "string" && input.attachmentName.trim() ? input.attachmentName.trim() : null);

      const updated = await client.query(
        `UPDATE supplier_bills
            SET status = $3,
                due_date = $4::date,
                notes = $5,
                attachment_name = $6,
                updated_at = now()
          WHERE organisation_id = $1 AND id = $2
          RETURNING id, bill_number AS "billNumber", status, bill_date::text AS "billDate",
                    due_date::text AS "dueDate", notes, attachment_name AS "attachmentName"`,
        [organisationId, billId, nextStatus, nextDueDate, nextNotes, nextAttachment],
      );
      const data = updated.rows[0];
      await client.query(
        `INSERT INTO audit_events (organisation_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
         VALUES ($1, $2, $3, 'bill', $4, $5::jsonb, $6::jsonb)`,
        [
          organisationId,
          userId,
          nextStatus !== existing.status ? `supplier_bill.${nextStatus}` : "supplier_bill.updated",
          billId,
          JSON.stringify(existing),
          JSON.stringify(data),
        ],
      );
      await client.query(
        `INSERT INTO idempotency_records (organisation_id, operation, idempotency_key, request_hash, response_data)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [organisationId, operation, key, hash, JSON.stringify(data)],
      );
      return { conflict: false as const, replayed: false, data };
    }, "bill:create_update");

    if ("missing" in outcome) return apiError(404, "BILL_NOT_FOUND", "Supplier bill not found.");
    if ("hasPayments" in outcome) return apiError(409, "BILL_HAS_PAYMENTS", "Bills with recorded payments cannot be cancelled.");
    if (outcome.conflict) return apiError(409, "IDEMPOTENCY_KEY_REUSED", "This idempotency key was used for a different bill update.");
    return NextResponse.json({ data: outcome.data, replayed: outcome.replayed }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiFailure(error, "BILL_UPDATE_FAILED", "Could not update the supplier bill.");
  }
}

