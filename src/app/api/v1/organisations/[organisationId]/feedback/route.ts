import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authenticatedUserId, apiError, apiFailure, isSameOrigin, withUserContext } from "@/lib/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ organisationId: string }> };

export async function POST(request: NextRequest, context: Context) {
  if (!isSameOrigin(request)) return apiError(403, "INVALID_ORIGIN", "Request origin could not be verified.");
  const userId = await authenticatedUserId();
  if (!userId) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
  const { organisationId } = await context.params;
  const key = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) return apiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Provide a valid Idempotency-Key header.");

  let body: unknown;
  try { body = await request.json(); } catch { return apiError(400, "INVALID_JSON", "Provide a valid JSON request."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return apiError(400, "INVALID_INPUT", "Feedback message is required.");
  const input = body as Record<string, unknown>;
  const message = typeof input.message === "string" ? input.message.trim() : "";
  if (Object.keys(input).some((f) => f !== "message") || message.length < 3 || message.length > 4000) {
    return apiError(400, "INVALID_INPUT", "Feedback message must be between 3 and 4,000 characters.");
  }

  const operation = "feedback.submit";
  const hash = createHash("sha256").update(JSON.stringify({ message })).digest("hex");
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

      const id = randomUUID();
      const inserted = await client.query(
        `INSERT INTO feedback_submissions (id, organisation_id, user_id, message)
         VALUES ($1, $2, $3, $4)
         RETURNING id, created_at AS "createdAt"`,
        [id, organisationId, userId, message],
      );
      const data = inserted.rows[0];
      await client.query(
        `INSERT INTO audit_events (organisation_id, actor_user_id, action, entity_type, entity_id, after_data)
         VALUES ($1, $2, 'feedback.submitted', 'workspace', $3, $4::jsonb)`,
        [organisationId, userId, id, JSON.stringify({ length: message.length })],
      );
      await client.query(
        `INSERT INTO idempotency_records (organisation_id, operation, idempotency_key, request_hash, response_data)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [organisationId, operation, key, hash, JSON.stringify(data)],
      );
      return { conflict: false as const, replayed: false, data };
    });

    if (outcome.conflict) return apiError(409, "IDEMPOTENCY_KEY_REUSED", "This idempotency key was used for a different feedback submission.");
    return NextResponse.json({ data: outcome.data, replayed: outcome.replayed }, { status: outcome.replayed ? 200 : 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiFailure(error, "FEEDBACK_SUBMIT_FAILED", "Could not submit feedback.");
  }
}

