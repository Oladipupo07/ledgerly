import { createHash, createHmac, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authenticatedUserId, apiError, apiFailure, isSameOrigin, withUserContext } from "@/lib/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ organisationId: string }> };

function invitationToken(organisationId: string, invitationId: string, key: string): string {
  const secret = process.env.INVITATION_SECRET || process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("Invitation signing secret is not configured");
  return createHmac("sha256", secret)
    .update(`${organisationId}:${invitationId}:${key}`)
    .digest("base64url");
}

export async function GET(_request: NextRequest, context: Context) {
  const userId = await authenticatedUserId();
  if (!userId) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
  const { organisationId } = await context.params;
  try {
    const data = await withUserContext(userId, organisationId, async (client) => {
      const result = await client.query(
        `SELECT id, invited_email AS email, display_name AS name, role, status,
                expires_at AS "expiresAt", created_at AS "createdAt", updated_at AS "updatedAt"
           FROM membership_invites WHERE organisation_id = $1
          ORDER BY created_at DESC LIMIT 200`,
        [organisationId],
      );
      return result.rows;
    }, "workspace:manage_members");
    return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiFailure(error, "INVITATIONS_UNAVAILABLE", "Workspace invitations are unavailable.");
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
  if (!body || typeof body !== "object" || Array.isArray(body)) return apiError(400, "INVALID_INPUT", "Invitation details are required.");
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((field) => !["name", "email", "role"].includes(field))) return apiError(400, "UNKNOWN_FIELD", "The request contains an unsupported field.");
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const role = input.role;
  if (!name || name.length > 160 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !["admin", "bookkeeper", "accountant"].includes(String(role))) {
    return apiError(400, "INVALID_INPUT", "Provide a valid name, email, and assignable workspace role.");
  }
  const operation = "member.invite";
  const hash = createHash("sha256").update(JSON.stringify({ name, email, role })).digest("hex");
  try {
    const outcome = await withUserContext(userId, organisationId, async (client) => {
      await client.query(
        `UPDATE membership_invites SET status = 'expired', updated_at = now()
          WHERE organisation_id = $1 AND status = 'pending' AND expires_at <= now()`,
        [organisationId],
      );
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${organisationId}:${operation}:${key}`]);
      const prior = await client.query(
        `SELECT request_hash, response_data FROM idempotency_records
          WHERE organisation_id = $1 AND operation = $2 AND idempotency_key = $3`,
        [organisationId, operation, key],
      );
      if (prior.rowCount) return prior.rows[0].request_hash === hash
        ? { conflict: false as const, replayed: true, data: prior.rows[0].response_data }
        : { conflict: true as const };

      const current = await client.query(
        `SELECT m.status FROM memberships m JOIN app_users u ON u.id = m.user_id
          WHERE m.organisation_id = $1 AND lower(u.email) = $2`,
        [organisationId, email],
      );
      if (current.rows.some((member) => member.status === "active")) return { alreadyMember: true as const };
      const pending = await client.query(
        `SELECT 1 FROM membership_invites
          WHERE organisation_id = $1 AND lower(invited_email) = $2 AND status = 'pending'`,
        [organisationId, email],
      );
      if (pending.rowCount) return { pendingInvite: true as const };

      const invitationId = randomUUID();
      const token = invitationToken(organisationId, invitationId, key);
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const created = await client.query(
        `INSERT INTO membership_invites
           (id, organisation_id, invited_email, display_name, role, token_hash, invited_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now() + interval '7 days')
         RETURNING id, invited_email AS email, display_name AS name, role, status,
                   expires_at AS "expiresAt", created_at AS "createdAt"`,
        [invitationId, organisationId, email, name, role, tokenHash, userId],
      );
      await client.query(
        `INSERT INTO audit_events (organisation_id, actor_user_id, action, entity_type, entity_id, after_data)
         VALUES ($1, $2, 'member.invited', 'member', $3, $4::jsonb)`,
        [organisationId, userId, invitationId, JSON.stringify({ email, role, expiresAt: created.rows[0].expiresAt })],
      );
      const data = created.rows[0];
      await client.query(
        `INSERT INTO idempotency_records (organisation_id, operation, idempotency_key, request_hash, response_data)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [organisationId, operation, key, hash, JSON.stringify(data)],
      );
      return { conflict: false as const, replayed: false, data: { ...data, token } };
    }, "workspace:manage_members");
    if ("alreadyMember" in outcome) return apiError(409, "ALREADY_MEMBER", "This email already belongs to an active workspace member.");
    if ("pendingInvite" in outcome) return apiError(409, "INVITATION_PENDING", "A pending invitation already exists for this email.");
    if (outcome.conflict) return apiError(409, "IDEMPOTENCY_KEY_REUSED", "This idempotency key was used for different invitation details.");
    const data = outcome.data as { token?: string; [key: string]: unknown };
    const token = data.token ?? invitationToken(organisationId, data.id as string, key);
    const baseUrl = process.env.AUTH_URL ?? request.nextUrl.origin;
    return NextResponse.json(
      { data: { ...data, token, acceptUrl: `${baseUrl}/invite/accept#token=${token}` }, replayed: outcome.replayed },
      { status: outcome.replayed ? 200 : 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiFailure(error, "INVITATION_CREATE_FAILED", "Could not create this invitation.");
  }
}
