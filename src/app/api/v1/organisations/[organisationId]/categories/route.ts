import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authenticatedUserId, apiError, apiFailure, isSameOrigin, withUserContext } from "@/lib/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ organisationId: string }> };

export async function GET(_request: NextRequest, context: Context) {
  const userId = await authenticatedUserId();
  if (!userId) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
  const { organisationId } = await context.params;
  try {
    const data = await withUserContext(userId, organisationId, async (client) => {
      const result = await client.query(
        `SELECT id, name, type, archived FROM categories
          WHERE organisation_id = $1 ORDER BY archived, lower(name)`,
        [organisationId],
      );
      return result.rows;
    });
    return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiFailure(error, "CATEGORIES_UNAVAILABLE", "Categories are unavailable.");
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
  if (!body || typeof body !== "object" || Array.isArray(body)) return apiError(400, "INVALID_INPUT", "Category details are required.");
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((field) => !["name", "type"].includes(field))) return apiError(400, "UNKNOWN_FIELD", "The request contains an unsupported field.");
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const type = input.type;
  if (!name || name.length > 80 || !["income", "expense", "both"].includes(String(type))) {
    return apiError(400, "INVALID_INPUT", "Provide a category name and type (income, expense, or both).");
  }
  const operation = "category.create";
  const hash = createHash("sha256").update(JSON.stringify({ name, type })).digest("hex");
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
      const result = await client.query(
        `INSERT INTO categories (id, organisation_id, name, type)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, type, archived`,
        [id, organisationId, name, type],
      );
      await client.query(
        `INSERT INTO audit_events (organisation_id, actor_user_id, action, entity_type, entity_id, after_data)
         VALUES ($1, $2, 'category.created', 'category', $3, $4::jsonb)`,
        [organisationId, userId, id, JSON.stringify({ name, type })],
      );
      const data = result.rows[0];
      await client.query(
        `INSERT INTO idempotency_records (organisation_id, operation, idempotency_key, request_hash, response_data)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [organisationId, operation, key, hash, JSON.stringify(data)],
      );
      return { conflict: false as const, replayed: false, data };
    }, "category:manage");
    if (outcome.conflict) return apiError(409, "IDEMPOTENCY_KEY_REUSED", "This idempotency key was used for different category details.");
    return NextResponse.json({ data: outcome.data, replayed: outcome.replayed }, {
      status: outcome.replayed ? 200 : 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") return apiError(409, "DUPLICATE_CATEGORY", "That category name already exists in this workspace.");
    return apiFailure(error, "CATEGORY_CREATE_FAILED", "Could not create this category.");
  }
}
