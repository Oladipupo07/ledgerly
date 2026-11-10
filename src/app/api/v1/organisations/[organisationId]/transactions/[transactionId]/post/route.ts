import { createHash } from "node:crypto";
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
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
    return apiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Provide an Idempotency-Key header between 8 and 128 safe characters.");
  }
  const operation = `transaction.post:${transactionId}`;
  const requestHash = createHash("sha256").update(operation).digest("hex");

  try {
    const result = await withUserContext(
      userId,
      organisationId,
      async (client) => {
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [`${organisationId}:${operation}:${idempotencyKey}`],
        );
        const prior = await client.query(
          `SELECT request_hash, response_data FROM idempotency_records
            WHERE organisation_id = $1 AND operation = $2 AND idempotency_key = $3`,
          [organisationId, operation, idempotencyKey],
        );
        if (prior.rowCount) {
          if (prior.rows[0].request_hash !== requestHash) {
            return { conflict: true as const };
          }
          return { conflict: false as const, replayed: true, data: prior.rows[0].response_data };
        }

        const record = await client.query(
          `SELECT id, transaction_date::text AS date, description, type, status,
                  amount_kobo::text AS "amountKobo", direction
             FROM transactions
            WHERE id = $1 AND organisation_id = $2
            FOR UPDATE`,
          [transactionId, organisationId],
        );
        if (!record.rowCount) return { missing: true as const };
        if (record.rows[0].status !== "draft") return { invalidState: true as const };

        const posted = await client.query(
          `UPDATE transactions SET status = 'posted'
            WHERE id = $1 AND organisation_id = $2 AND status = 'draft'
            RETURNING id, transaction_date::text AS date, description, type, status,
                      amount_kobo::text AS "amountKobo", direction`,
          [transactionId, organisationId],
        );
        const data = posted.rows[0];
        await client.query(
          `INSERT INTO audit_events
             (organisation_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
           VALUES ($1, $2, 'transaction.posted', 'transaction', $3, $4::jsonb, $5::jsonb)`,
          [organisationId, userId, transactionId, JSON.stringify({ status: "draft" }), JSON.stringify({ status: "posted" })],
        );
        await client.query(
          `INSERT INTO idempotency_records (organisation_id, operation, idempotency_key, request_hash, response_data)
           VALUES ($1, $2, $3, $4, $5::jsonb)`,
          [organisationId, operation, idempotencyKey, requestHash, JSON.stringify(data)],
        );
        return { conflict: false as const, replayed: false, data };
      },
      "transaction:post",
    );
    if ("missing" in result) return apiError(404, "NOT_FOUND", "Workspace or transaction not found.");
    if ("invalidState" in result) return apiError(409, "INVALID_STATE", "Only a draft transaction can be posted.");
    if (result.conflict) return apiError(409, "IDEMPOTENCY_KEY_REUSED", "This idempotency key was already used for a different request.");
    return NextResponse.json(
      { data: result.data, replayed: result.replayed },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiFailure(error, "POST_FAILED", "Could not post this transaction. Please retry.");
  }
}
