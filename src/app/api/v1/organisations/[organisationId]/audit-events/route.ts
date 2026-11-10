import { NextRequest, NextResponse } from "next/server";
import { hasCapability, type Role } from "@/lib/tenant";
import { authenticatedUserId, apiError, apiFailure, withUserContext } from "@/lib/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ organisationId: string }> };
function encodeCursor(value: string) { return Buffer.from(value, "utf8").toString("base64url"); }
function decodeCursor(value: string): { createdAt: string; publicId: string } | null {
  try {
    const [createdAt, publicId] = Buffer.from(value, "base64url").toString("utf8").split("|");
    if (!createdAt || !/^[0-9a-f-]{36}$/i.test(publicId ?? "") || Number.isNaN(Date.parse(createdAt))) return null;
    return { createdAt, publicId };
  } catch { return null; }
}

export async function GET(request: NextRequest, context: Context) {
  const userId = await authenticatedUserId();
  if (!userId) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
  const { organisationId } = await context.params;
  const url = new URL(request.url);
  const cursorText = url.searchParams.get("cursor");
  const cursor = cursorText ? decodeCursor(cursorText) : null;
  const requestedLimit = Number(url.searchParams.get("limit") ?? "50");
  const limit = Number.isInteger(requestedLimit) ? Math.min(100, Math.max(1, requestedLimit)) : 50;
  if (cursorText && !cursor) return apiError(400, "INVALID_CURSOR", "The audit cursor is invalid.");
  try {
    const data = await withUserContext(userId, organisationId, async (client) => {
      const membership = await client.query<{ role: Role }>(`SELECT role FROM memberships WHERE organisation_id = $1 AND user_id = $2 AND status = 'active'`, [organisationId, userId]);
      const full = hasCapability(membership.rows[0].role, "audit:view_all");
      const result = await client.query(
        `SELECT e.public_id AS id,
                e.actor_user_id AS "actorUserId",
                COALESCE(NULLIF(u.display_name, ''), u.email, e.actor_user_id::text) AS "actorName",
                m.role AS "actorRole",
                e.action,
                CASE
                  WHEN e.entity_type = 'import_batch' THEN 'import'
                  WHEN e.entity_type = 'organisation' THEN 'workspace'
                  ELSE e.entity_type
                END AS "entityType",
                e.entity_id AS "entityId",
                e.reason,
                e.before_data AS "before",
                e.after_data AS "after",
                e.created_at AS "createdAt"
           FROM audit_events e
           LEFT JOIN memberships m ON m.organisation_id = e.organisation_id AND m.user_id = e.actor_user_id
           LEFT JOIN app_users u ON u.id = e.actor_user_id
          WHERE e.organisation_id = $1
            AND ($2::boolean OR e.actor_user_id = $3 OR e.entity_type IN ('import', 'import_batch'))
            AND ($4::timestamptz IS NULL OR (e.created_at, e.public_id) < ($4::timestamptz, $5::uuid))
          ORDER BY e.created_at DESC, e.public_id DESC LIMIT $6`,
        [organisationId, full, userId, cursor?.createdAt ?? null, cursor?.publicId ?? null, limit + 1],
      );
      const rows = result.rows.slice(0, limit);
      const last = rows.at(-1);
      return { rows, nextCursor: result.rows.length > limit && last ? encodeCursor(`${new Date(last.createdAt).toISOString()}|${last.id}`) : null };
    });
    return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiFailure(error, "AUDIT_UNAVAILABLE", "Audit history is unavailable."); }
}
