import { NextRequest, NextResponse } from "next/server";
import { authenticatedUserId, apiError, apiFailure, withUserContext } from "@/lib/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ organisationId: string }> };

export async function GET(_request: NextRequest, context: Context) {
  const userId = await authenticatedUserId();
  if (!userId) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
  const { organisationId } = await context.params;
  try {
    const data = await withUserContext(userId, organisationId, async (client) => {
      const result = await client.query(
        `SELECT m.user_id AS id, COALESCE(m.display_name, u.display_name, '') AS name,
                COALESCE(m.invited_email, u.email) AS email, m.role, m.status,
                m.created_at AS "joinedAt", m.expires_at AS "inviteExpiresAt"
           FROM memberships m LEFT JOIN app_users u ON u.id = m.user_id
          WHERE m.organisation_id = $1 ORDER BY m.created_at, m.user_id`,
        [organisationId],
      );
      return result.rows;
    }, "workspace:manage_members");
    return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiFailure(error, "MEMBERS_UNAVAILABLE", "Workspace members are unavailable.");
  }
}
