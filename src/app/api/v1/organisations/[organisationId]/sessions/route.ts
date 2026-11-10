import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authenticatedUserId, apiError, apiFailure, isSameOrigin, withUserContext } from "@/lib/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ organisationId: string }> };

function describeDevice(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  const browser = ua.includes("edg/")
    ? "Microsoft Edge"
    : ua.includes("chrome/")
      ? "Google Chrome"
      : ua.includes("firefox/")
        ? "Mozilla Firefox"
        : ua.includes("safari/")
          ? "Apple Safari"
          : "Web Browser";
  const os = ua.includes("windows")
    ? "Windows"
    : ua.includes("mac os")
      ? "macOS"
      : ua.includes("android")
        ? "Android"
        : ua.includes("iphone") || ua.includes("ipad")
          ? "iOS"
          : ua.includes("linux")
            ? "Linux"
            : "Device";
  return `${browser} on ${os}`;
}

function sessionFingerprint(request: NextRequest, userId: string): string {
  const ua = request.headers.get("user-agent") ?? "unknown";
  return createHash("sha256").update(`${userId}:${ua}`).digest("hex").slice(0, 32);
}

export async function GET(request: NextRequest, context: Context) {
  const userId = await authenticatedUserId();
  if (!userId) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
  const { organisationId } = await context.params;
  const fp = sessionFingerprint(request, userId);
  const device = describeDevice(request.headers.get("user-agent") ?? "");
  try {
    const data = await withUserContext(userId, organisationId, async (client) => {
      await client.query(
        `INSERT INTO user_sessions (organisation_id, user_id, session_fingerprint, device, location, last_active_at, revoked_at)
         VALUES ($1, $2, $3, $4, 'Nigeria (WAT)', now(), NULL)
         ON CONFLICT (organisation_id, user_id, session_fingerprint)
         DO UPDATE SET device = EXCLUDED.device, last_active_at = now(), revoked_at = NULL`,
        [organisationId, userId, fp, device],
      );
      const result = await client.query(
        `SELECT id,
                device,
                location,
                last_active_at AS "lastActive",
                (session_fingerprint = $3) AS current
           FROM user_sessions
          WHERE organisation_id = $1 AND user_id = $2 AND revoked_at IS NULL
          ORDER BY (session_fingerprint = $3) DESC, last_active_at DESC
          LIMIT 20`,
        [organisationId, userId, fp],
      );
      return result.rows;
    });
    return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiFailure(error, "SESSIONS_UNAVAILABLE", "Active sessions could not be loaded.");
  }
}

export async function POST(request: NextRequest, context: Context) {
  if (!isSameOrigin(request)) return apiError(403, "INVALID_ORIGIN", "Request origin could not be verified.");
  const userId = await authenticatedUserId();
  if (!userId) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
  const { organisationId } = await context.params;
  const key = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) return apiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Provide a valid Idempotency-Key header.");
  const fp = sessionFingerprint(request, userId);
  const operation = "sessions.revoke_others";
  const hash = createHash("sha256").update(`${userId}:${fp}`).digest("hex");

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

      const revoked = await client.query(
        `UPDATE user_sessions
            SET revoked_at = now()
          WHERE organisation_id = $1 AND user_id = $2 AND session_fingerprint <> $3 AND revoked_at IS NULL`,
        [organisationId, userId, fp],
      );
      const revokedCount = revoked.rowCount ?? 0;
      await client.query(
        `INSERT INTO audit_events (organisation_id, actor_user_id, action, entity_type, entity_id, after_data)
         VALUES ($1, $2, 'session.revoked_others', 'workspace', $3, $4::jsonb)`,
        [organisationId, userId, userId, JSON.stringify({ revokedCount })],
      );
      const data = { revokedCount };
      await client.query(
        `INSERT INTO idempotency_records (organisation_id, operation, idempotency_key, request_hash, response_data)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [organisationId, operation, key, hash, JSON.stringify(data)],
      );
      return { conflict: false as const, replayed: false, data };
    });

    if (outcome.conflict) return apiError(409, "IDEMPOTENCY_KEY_REUSED", "This idempotency key was used for a different session action.");
    return NextResponse.json({ data: outcome.data, replayed: outcome.replayed }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiFailure(error, "SESSION_REVOKE_FAILED", "Could not revoke other active sessions.");
  }
}

