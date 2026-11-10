import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authenticatedUserId, apiError, apiFailure, isSameOrigin, withUserContext } from "@/lib/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ organisationId: string }> };
const safeString = (value: unknown, max: number) => typeof value === "string" && value.trim().length <= max;

export async function GET(_request: NextRequest, context: Context) {
  const userId = await authenticatedUserId();
  if (!userId) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
  const { organisationId } = await context.params;
  try {
    const data = await withUserContext(userId, organisationId, async (client) => {
      const result = await client.query(
        `SELECT id, name, roles, email, phone, business_id AS "businessId", notes, status,
                created_at AS "createdAt", updated_at AS "updatedAt"
           FROM contacts WHERE organisation_id = $1
          ORDER BY status, lower(name), id`,
        [organisationId],
      );
      return result.rows;
    });
    return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiFailure(error, "CONTACTS_UNAVAILABLE", "Contacts are unavailable.");
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
  if (!body || typeof body !== "object" || Array.isArray(body)) return apiError(400, "INVALID_INPUT", "Contact details are required.");
  const input = body as Record<string, unknown>;
  const allowed = new Set(["name", "roles", "email", "phone", "businessId", "notes", "confirmDuplicate"]);
  if (Object.keys(input).some((field) => !allowed.has(field))) return apiError(400, "UNKNOWN_FIELD", "The request contains an unsupported field.");
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const roles = Array.isArray(input.roles) ? [...new Set(input.roles)] : [];
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const phone = typeof input.phone === "string" ? input.phone.trim() : "";
  const businessId = typeof input.businessId === "string" ? input.businessId.trim() : "";
  const notes = typeof input.notes === "string" ? input.notes.trim() : "";
  if (!name || name.length > 160 || roles.length === 0 || roles.some((role) => role !== "customer" && role !== "supplier") ||
      !safeString(email, 254) || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) ||
      !safeString(phone, 40) || !safeString(businessId, 80) || !safeString(notes, 2000) ||
      typeof input.confirmDuplicate !== "undefined" && typeof input.confirmDuplicate !== "boolean") {
    return apiError(400, "INVALID_INPUT", "Provide a name, a customer or supplier role, and valid optional contact details.");
  }
  const normalized = { name, roles: roles.sort(), email: email || null, phone: phone || null, businessId: businessId || null, notes: notes || null };
  const requestHash = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
  try {
    const outcome = await withUserContext(userId, organisationId, async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`${organisationId}:contact.create:${key}`],
      );
      const prior = await client.query(
        `SELECT request_hash, response_data FROM idempotency_records
          WHERE organisation_id = $1 AND operation = 'contact.create' AND idempotency_key = $2`,
        [organisationId, key],
      );
      if (prior.rowCount) return prior.rows[0].request_hash === requestHash
        ? { conflict: false as const, replayed: true, data: prior.rows[0].response_data }
        : { conflict: true as const };

      const duplicate = await client.query(
        `SELECT id, name FROM contacts WHERE organisation_id = $1 AND status = 'active'
          AND (lower(name) = lower($2) OR ($3::text IS NOT NULL AND lower(email) = $3)
               OR ($4::text IS NOT NULL AND regexp_replace(coalesce(phone,''), '\\D', '', 'g') = regexp_replace($4, '\\D', '', 'g')))
          ORDER BY id LIMIT 1`,
        [organisationId, name, email || null, phone || null],
      );
      if (duplicate.rowCount && !input.confirmDuplicate) {
        return { duplicate: duplicate.rows[0] as { id: string; name: string } };
      }

      const id = randomUUID();
      const created = await client.query(
        `INSERT INTO contacts (id, organisation_id, name, roles, email, phone, business_id, notes)
         VALUES ($1, $2, $3, $4::text[], $5, $6, $7, $8)
         RETURNING id, name, roles, email, phone, business_id AS "businessId", notes, status,
                   created_at AS "createdAt", updated_at AS "updatedAt"`,
        [id, organisationId, name, normalized.roles, normalized.email, normalized.phone, normalized.businessId, normalized.notes],
      );
      await client.query(
        `INSERT INTO audit_events (organisation_id, actor_user_id, action, entity_type, entity_id, after_data)
         VALUES ($1, $2, 'contact.created', 'contact', $3, $4::jsonb)`,
        [organisationId, userId, id, JSON.stringify({ name, roles: normalized.roles })],
      );
      const data = created.rows[0];
      await client.query(
        `INSERT INTO idempotency_records (organisation_id, operation, idempotency_key, request_hash, response_data)
         VALUES ($1, 'contact.create', $2, $3, $4::jsonb)`,
        [organisationId, key, requestHash, JSON.stringify(data)],
      );
      return { conflict: false as const, replayed: false, data };
    }, "contact:manage");
    if ("duplicate" in outcome) return NextResponse.json(
      { error: { code: "POSSIBLE_DUPLICATE", message: "A similar contact exists. Confirm that you want to create a separate record.", match: outcome.duplicate } },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
    if (outcome.conflict) return apiError(409, "IDEMPOTENCY_KEY_REUSED", "This idempotency key was used for different contact details.");
    return NextResponse.json({ data: outcome.data, replayed: outcome.replayed }, {
      status: outcome.replayed ? 200 : 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiFailure(error, "CONTACT_CREATE_FAILED", "Could not create the contact.");
  }
}
