import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authenticatedUserId, apiError, apiFailure, isSameOrigin, withUserContext } from "@/lib/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ organisationId: string }> };
function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}
function nonNegativeKobo(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^\d{1,16}$/.test(value)) return null;
  const amount = BigInt(value);
  return amount <= 9_000_000_000_000_000n ? amount : null;
}

export async function GET(_request: NextRequest, context: Context) {
  const userId = await authenticatedUserId();
  if (!userId) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
  const { organisationId } = await context.params;
  try {
    const data = await withUserContext(userId, organisationId, async (client) => {
      const result = await client.query(
        `SELECT id, name, kind, masked_ref AS "maskedRef",
                opening_balance_kobo::text AS "openingBalanceKobo",
                opening_balance_date::text AS "openingBalanceDate", archived
           FROM tracking_accounts WHERE organisation_id = $1
          ORDER BY archived, name`,
        [organisationId],
      );
      return result.rows;
    });
    return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiFailure(error, "TRACKING_ACCOUNTS_UNAVAILABLE", "Tracking labels are unavailable.");
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
  if (!body || typeof body !== "object" || Array.isArray(body)) return apiError(400, "INVALID_INPUT", "Tracking label details are required.");
  const input = body as Record<string, unknown>;
  const allowed = new Set(["name", "kind", "maskedRef", "openingBalanceKobo", "openingBalanceDate"]);
  if (Object.keys(input).some((field) => !allowed.has(field))) return apiError(400, "UNKNOWN_FIELD", "The request contains an unsupported field.");
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const kind = input.kind;
  const maskedRef = typeof input.maskedRef === "string" ? input.maskedRef.trim() : "";
  const openingBalanceKobo = nonNegativeKobo(input.openingBalanceKobo ?? "0");
  const openingBalanceDate = input.openingBalanceDate ?? new Date().toISOString().slice(0, 10);
  if (!name || name.length > 100 || !["bank_label", "pos_label", "cash_label"].includes(String(kind)) ||
      maskedRef.length > 32 || openingBalanceKobo === null || !validDate(openingBalanceDate)) {
    return apiError(400, "INVALID_INPUT", "Provide a valid label name, kind, opening balance, and date.");
  }
  const normalized = { name, kind, maskedRef: maskedRef || null, openingBalanceKobo: openingBalanceKobo.toString(), openingBalanceDate };
  const operation = "tracking-account.create";
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
      const id = randomUUID();
      const created = await client.query(
        `INSERT INTO tracking_accounts
           (id, organisation_id, name, kind, masked_ref, opening_balance_kobo,
            opening_balance_date, opening_balance_recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8)
         RETURNING id, name, kind, masked_ref AS "maskedRef",
                   opening_balance_kobo::text AS "openingBalanceKobo",
                   opening_balance_date::text AS "openingBalanceDate", archived`,
        [id, organisationId, name, kind, maskedRef || null, openingBalanceKobo.toString(), openingBalanceDate, userId],
      );
      await client.query(
        `INSERT INTO audit_events (organisation_id, actor_user_id, action, entity_type, entity_id, after_data)
         VALUES ($1, $2, 'tracking_account.created', 'workspace', $3, $4::jsonb)`,
        [organisationId, userId, id, JSON.stringify({ name, kind, openingBalanceKobo: openingBalanceKobo.toString(), openingBalanceDate })],
      );
      const data = created.rows[0];
      await client.query(
        `INSERT INTO idempotency_records (organisation_id, operation, idempotency_key, request_hash, response_data)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [organisationId, operation, key, hash, JSON.stringify(data)],
      );
      return { conflict: false as const, replayed: false, data };
    }, "tracking_account:manage");
    if (outcome.conflict) return apiError(409, "IDEMPOTENCY_KEY_REUSED", "This idempotency key was used for different tracking label details.");
    return NextResponse.json({ data: outcome.data, replayed: outcome.replayed }, {
      status: outcome.replayed ? 200 : 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") return apiError(409, "DUPLICATE_TRACKING_LABEL", "That tracking label already exists in this workspace.");
    return apiFailure(error, "TRACKING_ACCOUNT_CREATE_FAILED", "Could not create this tracking label.");
  }
}
