import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authenticatedUserId, apiError, apiFailure, isSameOrigin, isUuid, withUserContext } from "@/lib/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ organisationId: string; transactionId: string }> };

export async function POST(request: NextRequest, context: Context) {
  if (!isSameOrigin(request)) return apiError(403, "INVALID_ORIGIN", "Request origin could not be verified.");
  const userId = await authenticatedUserId();
  if (!userId) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
  const { organisationId, transactionId } = await context.params;
  if (!isUuid(transactionId)) return apiError(404, "NOT_FOUND", "Workspace or transaction not found.");
  const key = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) return apiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Provide a valid Idempotency-Key header.");
  let body: unknown;
  try { body = await request.json(); } catch { return apiError(400, "INVALID_JSON", "Provide a valid JSON request."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return apiError(400, "INVALID_INPUT", "A correction reason is required.");
  const input = body as Record<string, unknown>;
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (Object.keys(input).some((field) => field !== "reason") || reason.length < 3 || reason.length > 500) {
    return apiError(400, "INVALID_REASON", "Provide a correction reason between 3 and 500 characters.");
  }
  const operation = `transaction.reverse:${transactionId}`;
  const requestHash = createHash("sha256").update(JSON.stringify({ transactionId, reason })).digest("hex");
  try {
    const outcome = await withUserContext(userId, organisationId, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${organisationId}:${operation}:${key}`]);
      const prior = await client.query(`SELECT request_hash, response_data FROM idempotency_records WHERE organisation_id = $1 AND operation = $2 AND idempotency_key = $3`, [organisationId, operation, key]);
      if (prior.rowCount) return prior.rows[0].request_hash === requestHash
        ? { conflict: false as const, replayed: true, data: prior.rows[0].response_data }
        : { conflict: true as const };

      const originalResult = await client.query(
        `SELECT id, transaction_date::text AS date, description, type, status, amount_kobo::text AS "amountKobo",
                direction, category_id AS "categoryId", tracking_account_id AS "trackingAccountId",
                transfer_to_account_id AS "transferToAccountId", contact_id AS "contactId", reference
           FROM transactions WHERE organisation_id = $1 AND id = $2 FOR UPDATE`,
        [organisationId, transactionId],
      );
      if (!originalResult.rowCount) return { missing: true as const };
      const original = originalResult.rows[0];
      if (original.status !== "posted") return { invalidState: true as const };

      const reversalId = randomUUID();
      const isTransfer = original.type === "transfer";
      const reversedDirection = original.direction === "inflow" ? "outflow" : "inflow";
      const sourceAccount = isTransfer ? original.transferToAccountId : original.trackingAccountId;
      const destinationAccount = isTransfer ? original.trackingAccountId : null;
      const data = {
        id: reversalId, date: original.date, description: `Reversal: ${original.description}`.slice(0, 240),
        type: original.type, status: "posted", amountKobo: original.amountKobo,
        direction: reversedDirection, categoryId: original.categoryId,
        trackingAccountId: sourceAccount, transferToAccountId: destinationAccount,
        contactId: original.contactId, reference: original.reference,
        reverses: transactionId, reason,
      };
      await client.query(
        `INSERT INTO transactions
           (id, organisation_id, transaction_date, description, type, status, amount_kobo, direction, category_id,
            tracking_account_id, transfer_to_account_id, contact_id, reference, source, created_by,
            idempotency_key, reverses, reversal_reason)
         VALUES ($1, $2, $3::date, $4, $5, 'posted', $6::bigint, $7, $8, $9, $10, $11, $12,
                 'reversal', $13, $14, $15, $16)`,
        [reversalId, organisationId, original.date, data.description, original.type, original.amountKobo,
          reversedDirection, original.categoryId, sourceAccount, destinationAccount, original.contactId,
          original.reference, userId, `reverse:${transactionId}`, transactionId, reason],
      );
      await client.query(
        `UPDATE transactions SET status = 'reversed', reversed_by = $3, reversal_reason = $4
          WHERE organisation_id = $1 AND id = $2 AND status = 'posted'`,
        [organisationId, transactionId, reversalId, reason],
      );
      await client.query(
        `INSERT INTO audit_events (organisation_id, actor_user_id, action, entity_type, entity_id, reason, before_data, after_data)
         VALUES ($1, $2, 'transaction.reversed', 'transaction', $3, $4, $5::jsonb, $6::jsonb)`,
        [organisationId, userId, transactionId, reason, JSON.stringify({ status: "posted" }), JSON.stringify({ status: "reversed", reversalId })],
      );
      await client.query(
        `INSERT INTO idempotency_records (organisation_id, operation, idempotency_key, request_hash, response_data)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [organisationId, operation, key, requestHash, JSON.stringify(data)],
      );
      return { conflict: false as const, replayed: false, data };
    }, "transaction:reverse");
    if ("missing" in outcome) return apiError(404, "NOT_FOUND", "Workspace or transaction not found.");
    if ("invalidState" in outcome) return apiError(409, "INVALID_STATE", "Only a posted transaction can be corrected.");
    if (outcome.conflict) return apiError(409, "IDEMPOTENCY_KEY_REUSED", "This idempotency key was used for a different correction.");
    return NextResponse.json({ data: outcome.data, replayed: outcome.replayed }, {
      status: outcome.replayed ? 200 : 201, headers: { "Cache-Control": "no-store" },
    });
  } catch (error) { return apiFailure(error, "REVERSAL_FAILED", "Could not record this correction."); }
}
