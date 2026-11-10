import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { calculateInvoiceTotals, parseQuantityMilli, parseTaxRateHundredths } from "@/lib/financial-backend";
import { authenticatedUserId, apiError, apiFailure, isSameOrigin, isUuid, withUserContext } from "@/lib/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ organisationId: string }> };
const maxAmountKobo = 9_000_000_000_000_000n;

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function parseNonNegativeKobo(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^\d{1,16}$/.test(value)) return null;
  try {
    const amount = BigInt(value);
    return amount <= maxAmountKobo ? amount : null;
  } catch { return null; }
}

function isText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length <= max;
}

export async function GET(_request: NextRequest, context: Context) {
  const userId = await authenticatedUserId();
  if (!userId) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
  const { organisationId } = await context.params;
  try {
    const data = await withUserContext(userId, organisationId, async (client) => {
      const result = await client.query(
        `SELECT i.id, i.invoice_number AS "invoiceNumber", i.customer_id AS "customerId",
                i.issue_date::text AS "issueDate", i.due_date::text AS "dueDate", i.status,
                i.discount_kobo::text AS "discountKobo", i.tax_label AS "taxLabel",
                i.tax_rate_percent::text AS "taxRatePercent", i.terms,
                i.payment_instructions AS "paymentInstructions", i.notes,
                i.last_reminder_sent_at AS "lastReminderSentAt",
                i.created_by AS "createdBy", i.created_at AS "createdAt", i.updated_at AS "updatedAt",
                COALESCE(lines.items, '[]'::jsonb) AS lines,
                COALESCE(receipts.items, '[]'::jsonb) AS receipts
           FROM invoices i
           LEFT JOIN LATERAL (
             SELECT jsonb_agg(jsonb_build_object(
               'id', l.id, 'description', l.description, 'quantity', l.quantity::text,
               'unitPriceKobo', l.unit_price_kobo::text
             ) ORDER BY l.line_number) AS items
               FROM invoice_lines l WHERE l.organisation_id = i.organisation_id AND l.invoice_id = i.id
           ) lines ON true
           LEFT JOIN LATERAL (
             SELECT jsonb_agg(jsonb_build_object(
               'id', r.id, 'date', r.receipt_date::text, 'amountKobo', r.amount_kobo::text,
               'methodLabel', r.method_label, 'reference', r.reference,
               'trackingAccountId', r.tracking_account_id, 'transactionId', r.transaction_id,
               'recordedBy', r.recorded_by, 'recordedAt', r.created_at
             ) ORDER BY r.receipt_date, r.created_at) AS items
               FROM invoice_receipts r WHERE r.organisation_id = i.organisation_id AND r.invoice_id = i.id
           ) receipts ON true
          WHERE i.organisation_id = $1
          ORDER BY i.issue_date DESC, i.created_at DESC
          LIMIT 500`,
        [organisationId],
      );
      return result.rows;
    });
    return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiFailure(error, "INVOICES_UNAVAILABLE", "Invoices are unavailable.");
  }
}

export async function POST(request: NextRequest, context: Context) {
  if (!isSameOrigin(request)) return apiError(403, "INVALID_ORIGIN", "Request origin could not be verified.");
  const userId = await authenticatedUserId();
  if (!userId) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
  const { organisationId } = await context.params;
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) return apiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Provide a valid Idempotency-Key header.");

  let body: unknown;
  try { body = await request.json(); } catch { return apiError(400, "INVALID_JSON", "Provide a valid JSON request."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return apiError(400, "INVALID_INPUT", "Invoice details are required.");
  const input = body as Record<string, unknown>;
  const allowed = new Set([
    "invoiceNumber", "customerId", "issueDate", "dueDate", "lines", "discountKobo",
    "taxLabel", "taxRatePercent", "terms", "paymentInstructions", "notes",
  ]);
  if (Object.keys(input).some((field) => !allowed.has(field))) return apiError(400, "UNKNOWN_FIELD", "The request contains an unsupported field.");

  const invoiceNumber = typeof input.invoiceNumber === "string" ? input.invoiceNumber.trim() : "";
  const customerId = input.customerId;
  const issueDate = input.issueDate;
  const dueDate = input.dueDate;
  const discountKobo = parseNonNegativeKobo(input.discountKobo ?? "0");
  const taxRateText = input.taxRatePercent === undefined ? "0" : input.taxRatePercent;
  const taxRate = parseTaxRateHundredths(taxRateText);
  const taxLabel = typeof input.taxLabel === "string" ? input.taxLabel.trim() : "";
  const terms = typeof input.terms === "string" ? input.terms.trim() : "";
  const paymentInstructions = typeof input.paymentInstructions === "string" ? input.paymentInstructions.trim() : "";
  const notes = typeof input.notes === "string" ? input.notes.trim() : "";
  if (
    !invoiceNumber || invoiceNumber.length > 40 || typeof customerId !== "string" || !isUuid(customerId) ||
    !validDate(issueDate) || !validDate(dueDate) || dueDate < issueDate || discountKobo === null ||
    taxRate === null || !isText(taxLabel, 120) || !isText(terms, 2000) ||
    !isText(paymentInstructions, 1000) || !isText(notes, 2000) ||
    !Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > 100
  ) {
    return apiError(400, "INVALID_INPUT", "Provide an invoice number, customer, valid dates, and at least one valid line item.");
  }

  const lines: Array<{ description: string; quantityText: string; quantityMilli: bigint; unitPriceKobo: bigint }> = [];
  for (const line of input.lines) {
    if (!line || typeof line !== "object" || Array.isArray(line)) return apiError(400, "INVALID_LINE", "Invoice line items must be objects.");
    const value = line as Record<string, unknown>;
    if (Object.keys(value).some((field) => !["description", "quantity", "unitPriceKobo"].includes(field))) {
      return apiError(400, "UNKNOWN_FIELD", "An invoice line contains an unsupported field.");
    }
    const description = typeof value.description === "string" ? value.description.trim() : "";
    const quantityText = typeof value.quantity === "string" ? value.quantity : "";
    const quantityMilli = parseQuantityMilli(quantityText);
    const unitPriceKobo = parseNonNegativeKobo(value.unitPriceKobo);
    if (!description || description.length > 240 || !quantityMilli || !unitPriceKobo) {
      return apiError(400, "INVALID_LINE", "Each invoice line needs a description, positive quantity, and non-negative unit amount in kobo.");
    }
    lines.push({ description, quantityText, quantityMilli, unitPriceKobo });
  }
  const totals = calculateInvoiceTotals(lines, discountKobo, taxRate);
  if (!totals || totals.totalKobo <= 0n || totals.totalKobo > maxAmountKobo) {
    return apiError(400, "INVALID_TOTAL", "Invoice discount or total is outside the allowed range.");
  }

  const normalized = {
    invoiceNumber, customerId, issueDate, dueDate,
    lines: lines.map(({ description, quantityText, unitPriceKobo }) => ({ description, quantity: quantityText, unitPriceKobo: unitPriceKobo.toString() })),
    discountKobo: discountKobo.toString(), taxLabel: taxLabel || null,
    taxRatePercent: (Number(taxRate) / 100).toFixed(2), terms, paymentInstructions, notes: notes || null,
  };
  const requestHash = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
  const operation = "invoice.create";
  try {
    const outcome = await withUserContext(userId, organisationId, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${organisationId}:${operation}:${idempotencyKey}`]);
      const prior = await client.query(
        `SELECT request_hash, response_data FROM idempotency_records
          WHERE organisation_id = $1 AND operation = $2 AND idempotency_key = $3`,
        [organisationId, operation, idempotencyKey],
      );
      if (prior.rowCount) return prior.rows[0].request_hash === requestHash
        ? { conflict: false as const, replayed: true, data: prior.rows[0].response_data }
        : { conflict: true as const };

      const customer = await client.query(
        `SELECT id FROM contacts WHERE organisation_id = $1 AND id = $2
           AND status = 'active' AND roles @> ARRAY['customer']::text[] FOR KEY SHARE`,
        [organisationId, customerId],
      );
      if (!customer.rowCount) return { missingCustomer: true as const };
      const id = randomUUID();
      await client.query(
        `INSERT INTO invoices
           (id, organisation_id, invoice_number, customer_id, issue_date, due_date,
            discount_kobo, tax_label, tax_rate_percent, terms, payment_instructions, notes, created_by)
         VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, $8, $9::numeric, $10, $11, $12, $13)`,
        [id, organisationId, invoiceNumber, customerId, issueDate, dueDate, discountKobo.toString(),
          taxLabel || null, normalized.taxRatePercent, terms, paymentInstructions, notes || null, userId],
      );
      for (const [index, line] of lines.entries()) {
        await client.query(
          `INSERT INTO invoice_lines (organisation_id, invoice_id, description, quantity, unit_price_kobo, line_number)
           VALUES ($1, $2, $3, $4::numeric, $5, $6)`,
          [organisationId, id, line.description, line.quantityText, line.unitPriceKobo.toString(), index + 1],
        );
      }
      const data = {
        id, invoiceNumber, customerId, issueDate, dueDate, status: "draft",
        discountKobo: discountKobo.toString(), taxLabel: taxLabel || null,
        taxRatePercent: normalized.taxRatePercent,
        subtotalKobo: totals.subtotalKobo.toString(), taxKobo: totals.taxKobo.toString(), totalKobo: totals.totalKobo.toString(),
      };
      await client.query(
        `INSERT INTO audit_events (organisation_id, actor_user_id, action, entity_type, entity_id, after_data)
         VALUES ($1, $2, 'invoice.draft_created', 'invoice', $3, $4::jsonb)`,
        [organisationId, userId, id, JSON.stringify({ invoiceNumber, totalKobo: totals.totalKobo.toString() })],
      );
      await client.query(
        `INSERT INTO idempotency_records (organisation_id, operation, idempotency_key, request_hash, response_data)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [organisationId, operation, idempotencyKey, requestHash, JSON.stringify(data)],
      );
      return { conflict: false as const, replayed: false, data };
    }, "invoice:create_send");
    if ("missingCustomer" in outcome) return apiError(400, "CUSTOMER_NOT_FOUND", "Choose an active customer in this workspace.");
    if (outcome.conflict) return apiError(409, "IDEMPOTENCY_KEY_REUSED", "This idempotency key was used for different invoice details.");
    return NextResponse.json({ data: outcome.data, replayed: outcome.replayed }, {
      status: outcome.replayed ? 200 : 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      return apiError(409, "DUPLICATE_INVOICE_NUMBER", "That invoice number is already in use in this workspace.");
    }
    return apiFailure(error, "INVOICE_CREATE_FAILED", "Could not create this invoice.");
  }
}
