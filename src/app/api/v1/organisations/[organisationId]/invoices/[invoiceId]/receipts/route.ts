import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { calculateInvoiceTotals, parseQuantityMilli, parseTaxRateHundredths } from "@/lib/financial-backend";
import { authenticatedUserId, apiError, apiFailure, isSameOrigin, isUuid, parsePositiveKobo, withUserContext } from "@/lib/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ organisationId: string; invoiceId: string }> };

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export async function POST(request: NextRequest, context: Context) {
  if (!isSameOrigin(request)) return apiError(403, "INVALID_ORIGIN", "Request origin could not be verified.");
  const userId = await authenticatedUserId();
  if (!userId) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
  const { organisationId, invoiceId } = await context.params;
  if (!isUuid(invoiceId)) return apiError(404, "NOT_FOUND", "Invoice not found.");
  const key = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) return apiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Provide a valid Idempotency-Key header.");

  let body: unknown;
  try { body = await request.json(); } catch { return apiError(400, "INVALID_JSON", "Provide a valid JSON request."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return apiError(400, "INVALID_INPUT", "Receipt details are required.");
  const input = body as Record<string, unknown>;
  const allowed = new Set(["amountKobo", "date", "methodLabel", "reference", "trackingAccountId", "confirmReceived"]);
  if (Object.keys(input).some((field) => !allowed.has(field))) return apiError(400, "UNKNOWN_FIELD", "The request contains an unsupported field.");
  const amountKobo = parsePositiveKobo(input.amountKobo);
  const date = input.date;
  const methodLabel = typeof input.methodLabel === "string" ? input.methodLabel.trim() : "Recorded receipt";
  const reference = typeof input.reference === "string" ? input.reference.trim() : "";
  const trackingAccountId = input.trackingAccountId;
  if (!amountKobo || !validDate(date) || methodLabel.length > 80 || !reference || reference.length > 120 ||
      typeof trackingAccountId !== "string" || !isUuid(trackingAccountId) || input.confirmReceived !== true) {
    return apiError(400, "INVALID_INPUT", "Confirm receipt and provide a valid amount, date, tracking label, and reference.");
  }
  const normalized = { amountKobo: amountKobo.toString(), date, methodLabel, reference, trackingAccountId };
  const operation = `invoice.receipt:${invoiceId}`;
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

      const invoiceResult = await client.query(
        `SELECT id, invoice_number AS "invoiceNumber", customer_id AS "customerId", status,
                discount_kobo::text AS "discountKobo", tax_rate_percent::text AS "taxRatePercent"
           FROM invoices WHERE organisation_id = $1 AND id = $2 FOR UPDATE`,
        [organisationId, invoiceId],
      );
      if (!invoiceResult.rowCount) return { missing: true as const };
      const invoice = invoiceResult.rows[0];
      if (!["shared", "partially_paid"].includes(invoice.status)) return { invalidState: true as const };

      const linesResult = await client.query(
        `SELECT description, quantity::text AS quantity, unit_price_kobo::text AS "unitPriceKobo"
           FROM invoice_lines WHERE organisation_id = $1 AND invoice_id = $2 ORDER BY line_number`,
        [organisationId, invoiceId],
      );
      const lines = linesResult.rows.map((line) => ({
        description: line.description as string,
        quantityMilli: parseQuantityMilli(line.quantity) ?? 0n,
        unitPriceKobo: BigInt(line.unitPriceKobo as string),
      }));
      const discount = BigInt(invoice.discountKobo as string);
      const taxRate = parseTaxRateHundredths(String(invoice.taxRatePercent ?? "0"));
      const totals = taxRate === null ? null : calculateInvoiceTotals(lines, discount, taxRate);
      if (!totals) return { corruptInvoice: true as const };
      const receiptsResult = await client.query(
        `SELECT COALESCE(sum(amount_kobo), 0)::text AS "receivedKobo"
           FROM invoice_receipts WHERE organisation_id = $1 AND invoice_id = $2`,
        [organisationId, invoiceId],
      );
      const receivedKobo = BigInt(receiptsResult.rows[0].receivedKobo as string);
      const outstandingKobo = totals.totalKobo - receivedKobo;
      if (outstandingKobo <= 0n || amountKobo > outstandingKobo) return { exceedsOutstanding: true as const };

      const txId = randomUUID();
      const receiptId = randomUUID();
      await client.query(
        `INSERT INTO transactions
           (id, organisation_id, transaction_date, description, type, status, amount_kobo, direction,
            tracking_account_id, contact_id, source, created_by, idempotency_key, reference)
         VALUES ($1, $2, $3::date, $4, 'income', 'posted', $5, 'inflow', $6, $7,
                 'invoice_receipt', $8, $9, $10)`,
        [txId, organisationId, date, `Invoice receipt ${invoice.invoiceNumber}`, amountKobo.toString(),
          trackingAccountId, invoice.customerId, userId, `invoice-receipt:${key}`, reference],
      );
      await client.query(
        `INSERT INTO invoice_receipts
           (id, organisation_id, invoice_id, transaction_id, receipt_date, amount_kobo,
            method_label, reference, tracking_account_id, recorded_by)
         VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, $9, $10)`,
        [receiptId, organisationId, invoiceId, txId, date, amountKobo.toString(), methodLabel,
          reference, trackingAccountId, userId],
      );
      const nextReceivedKobo = receivedKobo + amountKobo;
      const nextStatus = nextReceivedKobo === totals.totalKobo ? "paid" : "partially_paid";
      await client.query(
        `UPDATE invoices SET status = $3, updated_at = now()
          WHERE organisation_id = $1 AND id = $2`,
        [organisationId, invoiceId, nextStatus],
      );
      await client.query(
        `INSERT INTO audit_events (organisation_id, actor_user_id, action, entity_type, entity_id, after_data)
         VALUES ($1, $2, 'invoice.receipt_recorded', 'invoice', $3, $4::jsonb)`,
        [organisationId, userId, invoiceId, JSON.stringify({ receiptId, amountKobo: amountKobo.toString(), date, reference, status: nextStatus })],
      );
      const data = { id: receiptId, invoiceId, transactionId: txId, amountKobo: amountKobo.toString(), date, reference, status: nextStatus };
      await client.query(
        `INSERT INTO idempotency_records (organisation_id, operation, idempotency_key, request_hash, response_data)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [organisationId, operation, key, hash, JSON.stringify(data)],
      );
      return { conflict: false as const, replayed: false, data };
    }, "invoice:record_receipt");
    if ("missing" in outcome) return apiError(404, "NOT_FOUND", "Invoice not found.");
    if ("invalidState" in outcome) return apiError(409, "INVALID_STATE", "Only a shared invoice with an outstanding balance can receive a payment record.");
    if ("corruptInvoice" in outcome) return apiError(409, "INVALID_INVOICE_TOTAL", "Invoice totals could not be verified; contact support.");
    if ("exceedsOutstanding" in outcome) return apiError(409, "RECEIPT_EXCEEDS_BALANCE", "Receipt amount cannot exceed the remaining invoice balance.");
    if (outcome.conflict) return apiError(409, "IDEMPOTENCY_KEY_REUSED", "This idempotency key was used for different receipt details.");
    return NextResponse.json({ data: outcome.data, replayed: outcome.replayed }, {
      status: outcome.replayed ? 200 : 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiFailure(error, "RECEIPT_CREATE_FAILED", "Could not record this receipt.");
  }
}
