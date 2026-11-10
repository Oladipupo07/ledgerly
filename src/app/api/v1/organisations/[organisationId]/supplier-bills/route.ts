import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authenticatedUserId, apiError, apiFailure, isSameOrigin, isUuid, parsePositiveKobo, withUserContext } from "@/lib/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ organisationId: string }> };
function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export async function GET(_request: NextRequest, context: Context) {
  const userId = await authenticatedUserId();
  if (!userId) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
  const { organisationId } = await context.params;
  try {
    const data = await withUserContext(userId, organisationId, async (client) => {
      const result = await client.query(
        `SELECT b.id, b.bill_number AS "billNumber", b.supplier_id AS "supplierId",
                c.name AS "supplierName", b.bill_date::text AS "billDate", b.due_date::text AS "dueDate",
                b.amount_kobo::text AS "amountKobo", b.paid_amount_kobo::text AS "paidAmountKobo",
                b.category_id AS "categoryId", b.status, b.reference, b.notes,
                b.attachment_name AS "attachmentName",
                b.created_by AS "createdBy", b.created_at AS "createdAt", b.updated_at AS "updatedAt"
           FROM supplier_bills b JOIN contacts c
             ON c.organisation_id = b.organisation_id AND c.id = b.supplier_id
          WHERE b.organisation_id = $1
          ORDER BY b.due_date, b.created_at DESC LIMIT 500`,
        [organisationId],
      );
      return result.rows;
    });
    return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiFailure(error, "BILLS_UNAVAILABLE", "Supplier bills are unavailable.");
  }
}

export async function POST(request: NextRequest, context: Context) {
  if (!isSameOrigin(request)) return apiError(403, "INVALID_ORIGIN", "Request origin could not be verified.");
  const userId = await authenticatedUserId();
  if (!userId) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
  const { organisationId } = await context.params;
  const key = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) return apiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Provide a valid Idempotency-Key header.");
  let body: unknown;
  try { body = await request.json(); } catch { return apiError(400, "INVALID_JSON", "Provide a valid JSON request."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return apiError(400, "INVALID_INPUT", "Bill details are required.");
  const input = body as Record<string, unknown>;
  const allowed = new Set(["billNumber", "supplierId", "billDate", "dueDate", "amountKobo", "categoryId", "reference", "notes", "attachmentName"]);
  if (Object.keys(input).some((field) => !allowed.has(field))) return apiError(400, "UNKNOWN_FIELD", "The request contains an unsupported field.");
  const billNumber = typeof input.billNumber === "string" ? input.billNumber.trim() : "";
  const supplierId = input.supplierId;
  const billDate = input.billDate;
  const dueDate = input.dueDate;
  const amountKobo = parsePositiveKobo(input.amountKobo);
  const categoryId = input.categoryId;
  const reference = typeof input.reference === "string" ? input.reference.trim() : "";
  const notes = typeof input.notes === "string" ? input.notes.trim() : "";
  const attachmentName = typeof input.attachmentName === "string" ? input.attachmentName.trim() : "";
  if (!billNumber || billNumber.length > 40 || typeof supplierId !== "string" || !isUuid(supplierId) ||
      !validDate(billDate) || !validDate(dueDate) || typeof amountKobo !== "bigint" ||
      typeof categoryId !== "string" || !isUuid(categoryId) || reference.length > 120 || notes.length > 2000 || attachmentName.length > 200) {
    return apiError(400, "INVALID_INPUT", "Provide a bill number, supplier, valid dates, positive amount, and expense category.");
  }
  const normalized = { billNumber, supplierId, billDate, dueDate, amountKobo: amountKobo.toString(), categoryId, reference: reference || null, notes: notes || null, attachmentName: attachmentName || null };
  const operation = "supplier-bill.create";
  const hash = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
  try {
    const outcome = await withUserContext(userId, organisationId, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${organisationId}:${operation}:${key}`]);
      const prior = await client.query(
        `SELECT request_hash, response_data FROM idempotency_records
          WHERE organisation_id = $1 AND operation = $2 AND idempotency_key = $3`,
        [organisationId, operation, key],
      );
      if (prior.rowCount) return prior.rows[0].request_hash === hash
        ? { conflict: false as const, replayed: true, data: prior.rows[0].response_data }
        : { conflict: true as const };
      const refs = await client.query(
        `SELECT c.id AS "supplierId", cat.id AS "categoryId"
           FROM contacts c CROSS JOIN categories cat
          WHERE c.organisation_id = $1 AND c.id = $2 AND c.status = 'active'
            AND c.roles @> ARRAY['supplier']::text[] AND cat.organisation_id = $1
            AND cat.id = $3 AND cat.type IN ('expense','both') AND cat.archived = false`,
        [organisationId, supplierId, categoryId],
      );
      if (!refs.rowCount) return { invalidReference: true as const };
      const id = randomUUID();
      const result = await client.query(
        `INSERT INTO supplier_bills
           (id, organisation_id, bill_number, supplier_id, bill_date, due_date, amount_kobo,
            category_id, reference, notes, attachment_name, created_by)
         VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, $8, $9, $10, $11, $12)
         RETURNING id, bill_number AS "billNumber", supplier_id AS "supplierId", bill_date::text AS "billDate",
                   due_date::text AS "dueDate", amount_kobo::text AS "amountKobo",
                   paid_amount_kobo::text AS "paidAmountKobo", category_id AS "categoryId", status, reference, notes,
                   attachment_name AS "attachmentName"`,
        [id, organisationId, billNumber, supplierId, billDate, dueDate, amountKobo.toString(), categoryId, reference || null, notes || null, attachmentName || null, userId],
      );
      await client.query(
        `INSERT INTO audit_events (organisation_id, actor_user_id, action, entity_type, entity_id, after_data)
         VALUES ($1, $2, 'supplier_bill.created', 'bill', $3, $4::jsonb)`,
        [organisationId, userId, id, JSON.stringify({ billNumber, amountKobo: amountKobo.toString(), dueDate })],
      );
      const data = result.rows[0];
      await client.query(
        `INSERT INTO idempotency_records (organisation_id, operation, idempotency_key, request_hash, response_data)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [organisationId, operation, key, hash, JSON.stringify(data)],
      );
      return { conflict: false as const, replayed: false, data };
    }, "bill:create_update");
    if ("invalidReference" in outcome) return apiError(400, "INVALID_REFERENCE", "Choose an active supplier and expense category in this workspace.");
    if (outcome.conflict) return apiError(409, "IDEMPOTENCY_KEY_REUSED", "This idempotency key was used for different bill details.");
    return NextResponse.json({ data: outcome.data, replayed: outcome.replayed }, {
      status: outcome.replayed ? 200 : 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      return apiError(409, "DUPLICATE_BILL_NUMBER", "That bill number is already in use in this workspace.");
    }
    return apiFailure(error, "BILL_CREATE_FAILED", "Could not create this supplier bill.");
  }
}
