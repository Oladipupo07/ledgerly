import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authenticatedUserId, apiError, apiFailure, isSameOrigin, isUuid, withUserContext } from "@/lib/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ organisationId: string; accountId: string }> };

function nonNegativeKobo(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^\d{1,16}$/.test(value)) return null;
  const amount = BigInt(value);
  return amount <= 9_000_000_000_000_000n ? amount : null;
}

export async function PATCH(request: NextRequest, context: Context) {
  if (!isSameOrigin(request)) return apiError(403, "INVALID_ORIGIN", "Request origin could not be verified.");
  const userId = await authenticatedUserId();
  if (!userId) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
  const { organisationId, accountId } = await context.params;
  if (!isUuid(accountId)) return apiError(404, "TRACKING_ACCOUNT_NOT_FOUND", "Tracking label not found.");
  const key = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) return apiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Provide a valid Idempotency-Key header.");

  let body: unknown;
  try { body = await request.json(); } catch { return apiError(400, "INVALID_JSON", "Provide a valid JSON request."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return apiError(400, "INVALID_INPUT", "Tracking label updates are required.");
  const input = body as Record<string, unknown>;
  const allowed = new Set(["name", "maskedRef", "openingBalanceKobo", "archived"]);
  if (Object.keys(input).length === 0 || Object.keys(input).some((field) => !allowed.has(field))) {
    return apiError(400, "UNKNOWN_FIELD", "Provide valid tracking label fields to update.");
  }
  if (input.name !== undefined && (typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 100)) {
    return apiError(400, "INVALID_INPUT", "Tracking label name must be 1 to 100 characters.");
  }
  if (input.maskedRef !== undefined && input.maskedRef !== null && (typeof input.maskedRef !== "string" || input.maskedRef.trim().length > 32)) {
    return apiError(400, "INVALID_INPUT", "Reference note must be 32 characters or fewer.");
  }
  if (input.openingBalanceKobo !== undefined && nonNegativeKobo(input.openingBalanceKobo) === null) {
    return apiError(400, "INVALID_INPUT", "Provide a valid non-negative integer kobo opening balance.");
  }
  if (input.archived !== undefined && typeof input.archived !== "boolean") {
    return apiError(400, "INVALID_INPUT", "Archived flag must be a boolean.");
  }

  const operation = `tracking-account.update:${accountId}`;
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
        `SELECT id, name, kind, masked_ref AS "maskedRef",
                opening_balance_kobo::text AS "openingBalanceKobo",
                opening_balance_date::text AS "openingBalanceDate", archived
           FROM tracking_accounts WHERE organisation_id = $1 AND id = $2 FOR UPDATE`,
        [organisationId, accountId],
      );
      if (!current.rowCount) return { missing: true as const };
      const existing = current.rows[0];

      const nextName = typeof input.name === "string" ? input.name.trim() : existing.name;
      const nextMaskedRef = input.maskedRef === undefined ? existing.maskedRef : (typeof input.maskedRef === "string" && input.maskedRef.trim() ? input.maskedRef.trim() : null);
      const nextOpeningKobo = input.openingBalanceKobo !== undefined ? nonNegativeKobo(input.openingBalanceKobo)!.toString() : existing.openingBalanceKobo;
      const nextArchived = typeof input.archived === "boolean" ? input.archived : existing.archived;

      const updated = await client.query(
        `UPDATE tracking_accounts
            SET name = $3,
                masked_ref = $4,
                opening_balance_kobo = $5::bigint,
                archived = $6,
                updated_at = now()
          WHERE organisation_id = $1 AND id = $2
          RETURNING id, name, kind, masked_ref AS "maskedRef",
                    opening_balance_kobo::text AS "openingBalanceKobo",
                    opening_balance_date::text AS "openingBalanceDate", archived`,
        [organisationId, accountId, nextName, nextMaskedRef, nextOpeningKobo, nextArchived],
      );
      const data = updated.rows[0];
      await client.query(
        `INSERT INTO audit_events (organisation_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
         VALUES ($1, $2, $3, 'workspace', $4, $5::jsonb, $6::jsonb)`,
        [
          organisationId,
          userId,
          nextArchived !== existing.archived ? (nextArchived ? "tracking_account.archived" : "tracking_account.restored") : "tracking_account.updated",
          accountId,
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
    }, "tracking_account:manage");

    if ("missing" in outcome) return apiError(404, "TRACKING_ACCOUNT_NOT_FOUND", "Tracking label not found.");
    if (outcome.conflict) return apiError(409, "IDEMPOTENCY_KEY_REUSED", "This idempotency key was used for a different tracking label update.");
    return NextResponse.json({ data: outcome.data, replayed: outcome.replayed }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      return apiError(409, "DUPLICATE_TRACKING_LABEL", "That tracking label name already exists in this workspace.");
    }
    return apiFailure(error, "TRACKING_ACCOUNT_UPDATE_FAILED", "Could not update this tracking label.");
  }
}

