import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authenticatedUserId, apiError, apiFailure, isSameOrigin, isUuid, withUserContext } from "@/lib/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ organisationId: string; contactId: string }> };
const safeString = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length <= max;

export async function PATCH(request: NextRequest, context: Context) {
  if (!isSameOrigin(request)) return apiError(403, "INVALID_ORIGIN", "Request origin could not be verified.");
  const userId = await authenticatedUserId();
  if (!userId) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
  const { organisationId, contactId } = await context.params;
  if (!isUuid(contactId)) return apiError(404, "CONTACT_NOT_FOUND", "Contact not found.");
  const key = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) return apiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Provide a valid Idempotency-Key header.");

  let body: unknown;
  try { body = await request.json(); } catch { return apiError(400, "INVALID_JSON", "Provide a valid JSON request."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return apiError(400, "INVALID_INPUT", "Contact updates are required.");
  const input = body as Record<string, unknown>;
  const allowed = new Set(["name", "roles", "email", "phone", "businessId", "notes", "status"]);
  if (Object.keys(input).length === 0 || Object.keys(input).some((field) => !allowed.has(field))) {
    return apiError(400, "UNKNOWN_FIELD", "Provide valid contact fields to update.");
  }

  if (input.name !== undefined && (typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 160)) {
    return apiError(400, "INVALID_INPUT", "Contact name must be 1 to 160 characters.");
  }
  if (
    input.roles !== undefined &&
    (!Array.isArray(input.roles) ||
      input.roles.length === 0 ||
      input.roles.some((r) => r !== "customer" && r !== "supplier"))
  ) {
    return apiError(400, "INVALID_INPUT", "Choose customer, supplier, or both roles.");
  }
  if (input.email !== undefined && input.email !== null && (!safeString(input.email, 254) || (input.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())))) {
    return apiError(400, "INVALID_INPUT", "Provide a valid email address.");
  }
  if (input.phone !== undefined && input.phone !== null && !safeString(input.phone, 40)) {
    return apiError(400, "INVALID_INPUT", "Provide a valid phone number.");
  }
  if (input.businessId !== undefined && input.businessId !== null && !safeString(input.businessId, 80)) {
    return apiError(400, "INVALID_INPUT", "Business ID must be 80 characters or fewer.");
  }
  if (input.notes !== undefined && input.notes !== null && !safeString(input.notes, 2000)) {
    return apiError(400, "INVALID_INPUT", "Notes must be 2,000 characters or fewer.");
  }
  if (input.status !== undefined && input.status !== "active" && input.status !== "archived") {
    return apiError(400, "INVALID_INPUT", "Contact status must be active or archived.");
  }

  const operation = `contact.update:${contactId}`;
  const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  try {
    const outcome = await withUserContext(userId, organisationId, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${organisationId}:${operation}:${key}`]);
      const prior = await client.query(
        `SELECT request_hash, response_data FROM idempotency_records
          WHERE organisation_id = $1 AND operation = $2 AND idempotency_key = $3`,
        [organisationId, operation, key],
      );
      if (prior.rowCount) {
        return prior.rows[0].request_hash === requestHash
          ? { conflict: false as const, replayed: true, data: prior.rows[0].response_data }
          : { conflict: true as const };
      }

      const current = await client.query(
        `SELECT id, name, roles, email, phone, business_id AS "businessId", notes, status
           FROM contacts WHERE organisation_id = $1 AND id = $2 FOR UPDATE`,
        [organisationId, contactId],
      );
      if (!current.rowCount) return { missing: true as const };
      const existing = current.rows[0];

      const nextName = typeof input.name === "string" ? input.name.trim() : existing.name;
      const nextRoles = Array.isArray(input.roles) ? [...new Set(input.roles)].sort() : existing.roles;
      const nextEmail = input.email === undefined ? existing.email : (typeof input.email === "string" && input.email.trim() ? input.email.trim().toLowerCase() : null);
      const nextPhone = input.phone === undefined ? existing.phone : (typeof input.phone === "string" && input.phone.trim() ? input.phone.trim() : null);
      const nextBusinessId = input.businessId === undefined ? existing.businessId : (typeof input.businessId === "string" && input.businessId.trim() ? input.businessId.trim() : null);
      const nextNotes = input.notes === undefined ? existing.notes : (typeof input.notes === "string" && input.notes.trim() ? input.notes.trim() : null);
      const nextStatus = typeof input.status === "string" ? input.status : existing.status;

      const updated = await client.query(
        `UPDATE contacts
            SET name = $3,
                roles = $4::text[],
                email = $5,
                phone = $6,
                business_id = $7,
                notes = $8,
                status = $9,
                updated_at = now()
          WHERE organisation_id = $1 AND id = $2
          RETURNING id, name, roles, email, phone, business_id AS "businessId", notes, status,
                    created_at AS "createdAt", updated_at AS "updatedAt"`,
        [organisationId, contactId, nextName, nextRoles, nextEmail, nextPhone, nextBusinessId, nextNotes, nextStatus],
      );
      const data = updated.rows[0];
      await client.query(
        `INSERT INTO audit_events (organisation_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
         VALUES ($1, $2, $3, 'contact', $4, $5::jsonb, $6::jsonb)`,
        [
          organisationId,
          userId,
          nextStatus !== existing.status ? (nextStatus === "archived" ? "contact.archived" : "contact.restored") : "contact.updated",
          contactId,
          JSON.stringify(existing),
          JSON.stringify(data),
        ],
      );
      await client.query(
        `INSERT INTO idempotency_records (organisation_id, operation, idempotency_key, request_hash, response_data)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [organisationId, operation, key, requestHash, JSON.stringify(data)],
      );
      return { conflict: false as const, replayed: false, data };
    }, "contact:manage");

    if ("missing" in outcome) return apiError(404, "CONTACT_NOT_FOUND", "Contact not found.");
    if (outcome.conflict) return apiError(409, "IDEMPOTENCY_KEY_REUSED", "This idempotency key was used for a different contact update.");
    return NextResponse.json({ data: outcome.data, replayed: outcome.replayed }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiFailure(error, "CONTACT_UPDATE_FAILED", "Could not update the contact.");
  }
}
