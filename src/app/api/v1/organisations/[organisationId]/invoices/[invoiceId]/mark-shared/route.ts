import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authenticatedUserId, apiError, apiFailure, isSameOrigin, isUuid, withUserContext } from "@/lib/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ organisationId: string; invoiceId: string }> };

export async function POST(request: NextRequest, context: Context) {
  if (!isSameOrigin(request)) return apiError(403, "INVALID_ORIGIN", "Request origin could not be verified.");
  const userId = await authenticatedUserId();
  if (!userId) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
  const { organisationId, invoiceId } = await context.params;
  if (!isUuid(invoiceId)) return apiError(404, "NOT_FOUND", "Invoice not found.");
  const key = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) return apiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Provide a valid Idempotency-Key header.");
  const operation = `invoice.share:${invoiceId}`;
  const hash = createHash("sha256").update(operation).digest("hex");
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
      const invoice = await client.query(
        `SELECT id, invoice_number AS "invoiceNumber", status FROM invoices
          WHERE organisation_id = $1 AND id = $2 FOR UPDATE`,
        [organisationId, invoiceId],
      );
      if (!invoice.rowCount) return { missing: true as const };
      if (invoice.rows[0].status !== "draft") return { invalidState: true as const };
      const updated = await client.query(
        `UPDATE invoices SET status = 'shared', updated_at = now()
          WHERE organisation_id = $1 AND id = $2 AND status = 'draft'
          RETURNING id, invoice_number AS "invoiceNumber", status`,
        [organisationId, invoiceId],
      );
      const data = updated.rows[0];
      await client.query(
        `INSERT INTO audit_events (organisation_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
         VALUES ($1, $2, 'invoice.marked_shared', 'invoice', $3, $4::jsonb, $5::jsonb)`,
        [organisationId, userId, invoiceId, JSON.stringify({ status: "draft" }), JSON.stringify({ status: "shared" })],
      );
      await client.query(
        `INSERT INTO idempotency_records (organisation_id, operation, idempotency_key, request_hash, response_data)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [organisationId, operation, key, hash, JSON.stringify(data)],
      );
      return { conflict: false as const, replayed: false, data };
    }, "invoice:create_send");
    if ("missing" in outcome) return apiError(404, "NOT_FOUND", "Invoice not found.");
    if ("invalidState" in outcome) return apiError(409, "INVALID_STATE", "Only a draft invoice can be marked as shared.");
    if (outcome.conflict) return apiError(409, "IDEMPOTENCY_KEY_REUSED", "This idempotency key was used for a different request.");
    return NextResponse.json({ data: outcome.data, replayed: outcome.replayed }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiFailure(error, "INVOICE_SHARE_FAILED", "Could not update the invoice status.");
  }
}
