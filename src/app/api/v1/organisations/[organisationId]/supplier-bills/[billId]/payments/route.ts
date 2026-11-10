import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authenticatedUserId, apiError, apiFailure, isSameOrigin, isUuid, parsePositiveKobo, withUserContext } from "@/lib/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ organisationId: string; billId: string }> };
function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export async function POST(request: NextRequest, context: Context) {
  if (!isSameOrigin(request)) return apiError(403, "INVALID_ORIGIN", "Request origin could not be verified.");
  const userId = await authenticatedUserId();
  if (!userId) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
  const { organisationId, billId } = await context.params;
  if (!isUuid(billId)) return apiError(404, "NOT_FOUND", "Supplier bill not found.");
  const key = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) return apiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Provide a valid Idempotency-Key header.");
  let body: unknown;
  try { body = await request.json(); } catch { return apiError(400, "INVALID_JSON", "Provide a valid JSON request."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return apiError(400, "INVALID_INPUT", "Payment record details are required.");
  const input = body as Record<string, unknown>;
  const allowed = new Set(["amountKobo", "date", "trackingAccountId", "reference"]);
  if (Object.keys(input).some((field) => !allowed.has(field))) return apiError(400, "UNKNOWN_FIELD", "The request contains an unsupported field.");
  const amountKobo = parsePositiveKobo(input.amountKobo);
  const date = input.date;
  const trackingAccountId = input.trackingAccountId;
  const reference = typeof input.reference === "string" ? input.reference.trim() : "";
  if (!amountKobo || !validDate(date) || typeof trackingAccountId !== "string" || !isUuid(trackingAccountId) || !reference || reference.length > 120) {
    return apiError(400, "INVALID_INPUT", "Provide a positive amount, valid payment date, tracking label, and reference.");
  }
  const normalized = { amountKobo: amountKobo.toString(), date, trackingAccountId, reference };
  const operation = `supplier-bill.payment:${billId}`;
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
      const billResult = await client.query(
        `SELECT id, bill_number AS "billNumber", supplier_id AS "supplierId",
                amount_kobo::text AS "amountKobo", paid_amount_kobo::text AS "paidAmountKobo",
                category_id AS "categoryId", status
           FROM supplier_bills WHERE organisation_id = $1 AND id = $2 FOR UPDATE`,
        [organisationId, billId],
      );
      if (!billResult.rowCount) return { missing: true as const };
      const bill = billResult.rows[0];
      if (bill.status === "paid" || bill.status === "cancelled") return { invalidState: true as const };
      const outstanding = BigInt(bill.amountKobo as string) - BigInt(bill.paidAmountKobo as string);
      if (amountKobo > outstanding) return { exceedsOutstanding: true as const };
      const txId = randomUUID();
      const paymentId = randomUUID();
      await client.query(
        `INSERT INTO transactions
           (id, organisation_id, transaction_date, description, type, status, amount_kobo, direction,
            category_id, tracking_account_id, contact_id, bill_id, source, created_by, idempotency_key, reference)
         VALUES ($1, $2, $3::date, $4, 'expense', 'posted', $5, 'outflow', $6, $7, $8, $9,
                 'bill_payment', $10, $11, $12)`,
        [txId, organisationId, date, `Supplier bill payment ${bill.billNumber}`, amountKobo.toString(),
          bill.categoryId, trackingAccountId, bill.supplierId, billId, userId, `bill-payment:${key}`, reference],
      );
      await client.query(
        `INSERT INTO supplier_bill_payments
           (id, organisation_id, bill_id, transaction_id, payment_date, amount_kobo, reference, recorded_by)
         VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8)`,
        [paymentId, organisationId, billId, txId, date, amountKobo.toString(), reference, userId],
      );
      const nextPaid = BigInt(bill.paidAmountKobo as string) + amountKobo;
      const status = nextPaid === BigInt(bill.amountKobo as string) ? "paid" : "partially_paid";
      await client.query(
        `UPDATE supplier_bills SET paid_amount_kobo = $3, status = $4, updated_at = now()
          WHERE organisation_id = $1 AND id = $2`,
        [organisationId, billId, nextPaid.toString(), status],
      );
      await client.query(
        `INSERT INTO audit_events (organisation_id, actor_user_id, action, entity_type, entity_id, after_data)
         VALUES ($1, $2, 'supplier_bill.payment_recorded', 'bill', $3, $4::jsonb)`,
        [organisationId, userId, billId, JSON.stringify({ paymentId, amountKobo: amountKobo.toString(), date, reference, status })],
      );
      const data = { id: paymentId, billId, transactionId: txId, amountKobo: amountKobo.toString(), date, reference, status };
      await client.query(
        `INSERT INTO idempotency_records (organisation_id, operation, idempotency_key, request_hash, response_data)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [organisationId, operation, key, hash, JSON.stringify(data)],
      );
      return { conflict: false as const, replayed: false, data };
    }, "bill:create_update");
    if ("missing" in outcome) return apiError(404, "NOT_FOUND", "Supplier bill not found.");
    if ("invalidState" in outcome) return apiError(409, "INVALID_STATE", "This supplier bill is already paid or cancelled.");
    if ("exceedsOutstanding" in outcome) return apiError(409, "PAYMENT_EXCEEDS_BALANCE", "Payment amount cannot exceed the outstanding bill balance.");
    if (outcome.conflict) return apiError(409, "IDEMPOTENCY_KEY_REUSED", "This idempotency key was used for different payment details.");
    return NextResponse.json({ data: outcome.data, replayed: outcome.replayed }, {
      status: outcome.replayed ? 200 : 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiFailure(error, "BILL_PAYMENT_FAILED", "Could not record this supplier bill payment.");
  }
}
