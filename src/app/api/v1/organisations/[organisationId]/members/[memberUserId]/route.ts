import { NextRequest, NextResponse } from "next/server";
import { authenticatedUserId, apiError, apiFailure, isSameOrigin, withUserContext } from "@/lib/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ organisationId: string; memberUserId: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  if (!isSameOrigin(request)) return apiError(403, "INVALID_ORIGIN", "Request origin could not be verified.");
  const actorId = await authenticatedUserId();
  if (!actorId) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
  const { organisationId, memberUserId } = await context.params;
  if (!memberUserId || memberUserId.length > 200) return apiError(400, "INVALID_MEMBER", "Choose a valid workspace member.");
  let body: unknown;
  try { body = await request.json(); } catch { return apiError(400, "INVALID_JSON", "Provide a valid JSON request."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return apiError(400, "INVALID_INPUT", "Member changes are required.");
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["role", "status"].includes(key)) ||
      (input.role === undefined && input.status === undefined) ||
      (input.role !== undefined && !["admin", "bookkeeper", "accountant"].includes(String(input.role))) ||
      (input.status !== undefined && !["active", "deactivated"].includes(String(input.status)))) {
    return apiError(400, "INVALID_INPUT", "Choose an allowed role or active status.");
  }
  if (actorId === memberUserId && input.status === "deactivated") return apiError(400, "SELF_DEACTIVATION", "Ask another workspace administrator to deactivate your access.");
  try {
    const result = await withUserContext(actorId, organisationId, async (client) => {
      const actor = await client.query(`SELECT role FROM memberships WHERE organisation_id = $1 AND user_id = $2 AND status = 'active'`, [organisationId, actorId]);
      const target = await client.query(`SELECT role, status FROM memberships WHERE organisation_id = $1 AND user_id = $2 FOR UPDATE`, [organisationId, memberUserId]);
      if (!target.rowCount) return { missing: true as const };
      const before = target.rows[0] as { role: string; status: string };
      if (before.role === "owner") return { protectedOwner: true as const };
      if (actor.rows[0]?.role === "admin" && input.role === "admin") return { forbiddenRole: true as const };
      const role = (input.role as string | undefined) ?? before.role;
      const status = (input.status as string | undefined) ?? before.status;
      await client.query(`UPDATE memberships SET role = $3, status = $4, updated_at = now() WHERE organisation_id = $1 AND user_id = $2`, [organisationId, memberUserId, role, status]);
      await client.query(
        `INSERT INTO audit_events (organisation_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
         VALUES ($1, $2, 'member.updated', 'member', $3, $4::jsonb, $5::jsonb)`,
        [organisationId, actorId, memberUserId, JSON.stringify(before), JSON.stringify({ role, status })],
      );
      return { member: { userId: memberUserId, role, status } };
    }, "workspace:manage_members");
    if ("missing" in result) return apiError(404, "MEMBER_NOT_FOUND", "Workspace member not found.");
    if ("protectedOwner" in result) return apiError(409, "OWNER_PROTECTED", "Primary ownership cannot be changed here.");
    if ("forbiddenRole" in result) return apiError(403, "ROLE_ASSIGNMENT_FORBIDDEN", "Only the owner can assign the admin role.");
    return NextResponse.json({ data: result.member }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiFailure(error, "MEMBER_UPDATE_FAILED", "Could not update this workspace member."); }
}
