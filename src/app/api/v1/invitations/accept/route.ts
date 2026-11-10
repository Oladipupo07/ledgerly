import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { apiError, apiFailure, isSameOrigin, withUserContext } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return apiError(403, "INVALID_ORIGIN", "Request origin could not be verified.");
  const session = await auth();
  const userId = session?.user?.id;
  const email = session?.user?.email?.trim().toLowerCase();
  if (!userId || !email) return apiError(401, "UNAUTHENTICATED", "Sign in with the invited email address to continue.");
  let body: unknown;
  try { body = await request.json(); } catch { return apiError(400, "INVALID_JSON", "Provide a valid JSON request."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return apiError(400, "INVALID_INPUT", "Invitation token is required.");
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((field) => field !== "token") || typeof input.token !== "string" || !/^[A-Za-z0-9_-]{40,64}$/.test(input.token)) {
    return apiError(400, "INVALID_INPUT", "Provide a valid invitation token.");
  }
  const tokenHash = createHash("sha256").update(input.token).digest("hex");
  try {
    const result = await withUserContext(userId, null, async (client) => {
      await client.query(
        `INSERT INTO app_users (id, email, display_name) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, display_name = EXCLUDED.display_name`,
        [userId, email, session.user?.name ?? ""],
      );
      const invite = await client.query(
        `SELECT id, organisation_id AS "organisationId", role, display_name AS name, status, expires_at AS "expiresAt"
           FROM membership_invites
          WHERE token_hash = $1 AND status = 'pending' AND expires_at > now()
            AND lower(invited_email) = $2
          FOR UPDATE`,
        [tokenHash, email],
      );
      if (!invite.rowCount) return { invalid: true as const };
      const invitation = invite.rows[0];
      const organisationId = invitation.organisationId as string;
      await client.query("SELECT set_config('app.organisation_id', $1, true)", [organisationId]);
      const current = await client.query(
        `SELECT status FROM memberships WHERE organisation_id = $1 AND user_id = $2 FOR UPDATE`,
        [organisationId, userId],
      );
      if (current.rows.some((membership) => membership.status === "active")) return { alreadyMember: true as const };
      if (current.rowCount) {
        await client.query(
          `UPDATE memberships SET role = $3, status = 'active', invited_email = NULL,
             display_name = $4, expires_at = NULL, updated_at = now()
           WHERE organisation_id = $1 AND user_id = $2`,
          [organisationId, userId, invitation.role, invitation.name],
        );
      } else {
        await client.query(
          `INSERT INTO memberships
             (user_id, organisation_id, role, status, invited_email, display_name, invited_by, expires_at)
           SELECT $1, $2, $3, 'active', NULL, $4, invited_by, expires_at
             FROM membership_invites WHERE id = $5`,
          [userId, organisationId, invitation.role, invitation.name, invitation.id],
        );
      }
      await client.query(
        `UPDATE membership_invites SET status = 'accepted', accepted_by = $2,
             accepted_at = now(), updated_at = now()
          WHERE id = $1`,
        [invitation.id, userId],
      );
      await client.query(
        `INSERT INTO audit_events (organisation_id, actor_user_id, action, entity_type, entity_id, after_data)
         VALUES ($1, $2, 'member.invitation_accepted', 'member', $2, $3::jsonb)`,
        [organisationId, userId, JSON.stringify({ role: invitation.role })],
      );
      return { invalid: false as const, organisationId, role: invitation.role };
    });
    if ("invalid" in result && result.invalid) return apiError(400, "INVITATION_INVALID", "This invitation is invalid, expired, or belongs to another email address.");
    if ("alreadyMember" in result) return apiError(409, "ALREADY_MEMBER", "You already have active access to this workspace.");
    return NextResponse.json({ data: result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiFailure(error, "INVITATION_ACCEPT_FAILED", "Could not accept this invitation.");
  }
}
