import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { hasSameRequestFields } from "@/lib/financial-backend";
import { authenticatedUserId, apiError, apiFailure, isSameOrigin, isUuid, parsePositiveKobo, withUserContext } from "@/lib/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ organisationId: string }> };
const transactionTypes = new Set(["income", "expense", "transfer", "refund", "adjustment"]);
const allowedInputKeys = new Set([
  "date", "description", "type", "direction", "amountKobo", "trackingAccountId",
  "categoryId", "transferToAccountId", "contactId", "reference", "notes", "attachmentName",
]);

function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function isOptionalUuid(value: unknown): value is string | null {
  return value === undefined || value === null || (typeof value === "string" && isUuid(value));
}

export async function GET(_request: NextRequest, context: Context) {
  const userId = await authenticatedUserId();
  if (!userId) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
  const { organisationId } = await context.params;
  try {
    const data = await withUserContext(userId, organisationId, async (client) => {
      const result = await client.query(
        `SELECT id, transaction_date::text AS date, description, type, status,
                amount_kobo::text AS "amountKobo", direction, category_id AS "categoryId",
                tracking_account_id AS "trackingAccountId", transfer_to_account_id AS "transferToAccountId",
                contact_id AS "contactId", source, reference, notes,
                attachment_name AS "attachmentName", import_batch_id AS "importBatchId",
                bill_id AS "billId",
                reversed_by AS "reversedBy", reverses, reversal_reason AS "reversalReason", created_by AS "createdBy",
                created_at AS "createdAt"
           FROM transactions
          WHERE organisation_id = $1
          ORDER BY transaction_date DESC, created_at DESC
          LIMIT 500`,
        [organisationId],
      );
      return result.rows;
    });
    return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiFailure(error, "BACKEND_UNAVAILABLE", "Transaction storage is unavailable.");
  }
}

export async function POST(request: NextRequest, context: Context) {
  if (!isSameOrigin(request)) return apiError(403, "INVALID_ORIGIN", "Request origin could not be verified.");
  const userId = await authenticatedUserId();
  if (!userId) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
  const { organisationId } = await context.params;
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
    return apiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Provide an Idempotency-Key header between 8 and 128 safe characters.");
  }

  let body: unknown;
  try { body = await request.json(); } catch { return apiError(400, "INVALID_JSON", "Provide a valid JSON request."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return apiError(400, "INVALID_INPUT", "Transaction details are required.");
  }
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((key) => !allowedInputKeys.has(key))) {
    return apiError(400, "UNKNOWN_FIELD", "The request contains an unsupported field.");
  }

  const description = typeof input.description === "string" ? input.description.trim() : "";
  const date = input.date;
  const type = typeof input.type === "string" ? input.type : "";
  const direction = input.direction;
  const amountKobo = parsePositiveKobo(input.amountKobo);
  const trackingAccountId = input.trackingAccountId;
  const categoryId = input.categoryId === undefined || input.categoryId === null ? null : input.categoryId;
  const contactId = input.contactId === undefined || input.contactId === null ? null : input.contactId;
  const transferToAccountId = input.transferToAccountId === undefined || input.transferToAccountId === null
    ? null
    : input.transferToAccountId;
  const reference = typeof input.reference === "string" ? input.reference.trim() : "";
  const notes = typeof input.notes === "string" ? input.notes.trim() : "";
  const attachmentName = typeof input.attachmentName === "string" ? input.attachmentName.trim() : "";

  if (
    !description || description.length > 240 || !isDate(date) || !transactionTypes.has(type) ||
    !["inflow", "outflow"].includes(String(direction)) || !amountKobo ||
    typeof trackingAccountId !== "string" || !isUuid(trackingAccountId) ||
    !isOptionalUuid(categoryId) || !isOptionalUuid(contactId) || !isOptionalUuid(transferToAccountId) ||
    reference.length > 120 || notes.length > 2000 || attachmentName.length > 200
  ) {
    return apiError(400, "INVALID_INPUT", "Provide a valid date, description, positive integer kobo amount, direction, category, and tracking label.");
  }
  if ((type === "income" && direction !== "inflow") || (type === "expense" && direction !== "outflow")) {
    return apiError(400, "INVALID_DIRECTION", "Income must be an inflow and expense must be an outflow.");
  }
  if (type === "transfer" && (!transferToAccountId || transferToAccountId === trackingAccountId || direction !== "outflow")) {
    return apiError(400, "INVALID_TRANSFER", "A transfer needs a different destination tracking label and an outflow direction.");
  }
  if (type !== "transfer" && transferToAccountId) {
    return apiError(400, "INVALID_TRANSFER", "A destination tracking label is only allowed for transfers.");
  }
  if (typeof input.reference !== "undefined" && typeof input.reference !== "string") {
    return apiError(400, "INVALID_INPUT", "Reference must be text.");
  }
  if (typeof input.notes !== "undefined" && typeof input.notes !== "string") {
    return apiError(400, "INVALID_INPUT", "Notes must be text.");
  }
  if (typeof input.attachmentName !== "undefined" && typeof input.attachmentName !== "string") {
    return apiError(400, "INVALID_INPUT", "Attachment name must be text.");
  }

  try {
    const { data, replayed } = await withUserContext(
      userId,
      organisationId,
      async (client) => {
        // Serialize retries so concurrent requests with the same key return the
        // original draft instead of racing the unique constraint.
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [`${organisationId}:transaction.create:${idempotencyKey}`],
        );
        const existing = await client.query(
          `SELECT id, transaction_date::text AS date, description, type, status,
                  amount_kobo::text AS "amountKobo", direction, category_id AS "categoryId",
                  tracking_account_id AS "trackingAccountId", transfer_to_account_id AS "transferToAccountId",
                  contact_id AS "contactId", reference, notes, attachment_name AS "attachmentName"
             FROM transactions WHERE organisation_id = $1 AND idempotency_key = $2`,
          [organisationId, idempotencyKey],
        );
        const normalized = {
          date, description, type, amountKobo: amountKobo.toString(), direction,
          categoryId, trackingAccountId, transferToAccountId, contactId,
          reference: reference || null, notes: notes || null,
        };
        if (existing.rowCount) {
          const saved = existing.rows[0];
          const same = hasSameRequestFields(saved, normalized);
          if (!same) return { data: null, replayed: false };
          return { data: saved, replayed: true };
        }

        const id = randomUUID();
        const created = await client.query(
          `INSERT INTO transactions
             (id, organisation_id, transaction_date, description, type, status, amount_kobo, direction,
              category_id, tracking_account_id, transfer_to_account_id, contact_id, source,
              created_by, idempotency_key, reference, notes, attachment_name)
           VALUES ($1, $2, $3::date, $4, $5, 'draft', $6::bigint, $7, $8, $9, $10, $11,
                   'manual', $12, $13, $14, $15, $16)
           RETURNING id, transaction_date::text AS date, description, type, status,
                     amount_kobo::text AS "amountKobo", direction, category_id AS "categoryId",
                     tracking_account_id AS "trackingAccountId", transfer_to_account_id AS "transferToAccountId",
                     contact_id AS "contactId", reference, notes, attachment_name AS "attachmentName"`,
          [id, organisationId, date, description, type, amountKobo.toString(), direction,
            categoryId, trackingAccountId, transferToAccountId, contactId, userId, idempotencyKey,
            reference || null, notes || null, attachmentName || null],
        );
        await client.query(
          `INSERT INTO audit_events (organisation_id, actor_user_id, action, entity_type, entity_id, after_data)
           VALUES ($1, $2, 'transaction.draft_created', 'transaction', $3, $4::jsonb)`,
          [organisationId, userId, id, JSON.stringify({ amountKobo: amountKobo.toString(), type, date })],
        );
        return { data: created.rows[0], replayed: false };
      },
      "transaction:create_edit",
    );
    if (!data) return apiError(409, "IDEMPOTENCY_KEY_REUSED", "This idempotency key was already used for different transaction details.");
    return NextResponse.json({ data, replayed }, { status: replayed ? 200 : 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiFailure(error, "TRANSACTION_REJECTED", "The transaction was rejected. Verify that its category and tracking label belong to this workspace.");
  }
}
