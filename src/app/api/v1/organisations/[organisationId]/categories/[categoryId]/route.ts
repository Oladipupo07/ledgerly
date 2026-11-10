import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authenticatedUserId, apiError, apiFailure, isSameOrigin, isUuid, withUserContext } from "@/lib/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ organisationId: string; categoryId: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  if (!isSameOrigin(request)) return apiError(403, "INVALID_ORIGIN", "Request origin could not be verified.");
  const userId = await authenticatedUserId();
  if (!userId) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
  const { organisationId, categoryId } = await context.params;
  if (!isUuid(categoryId)) return apiError(404, "NOT_FOUND", "Category not found.");
  const key = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) return apiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Provide a valid Idempotency-Key header.");
  let body: unknown;
  try { body = await request.json(); } catch { return apiError(400, "INVALID_JSON", "Provide a valid JSON request."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return apiError(400, "INVALID_INPUT", "Category changes are required.");
  const input = body as Record<string, unknown>;
  if (!Object.keys(input).length || Object.keys(input).some((field) => !["name", "archived"].includes(field))) {
    return apiError(400, "INVALID_INPUT", "Provide a category name or archived state.");
  }
  const name = input.name === undefined ? undefined : typeof input.name === "string" ? input.name.trim() : null;
  if (name === null || name === "" || (name && name.length > 80) ||
      input.archived !== undefined && typeof input.archived !== "boolean") {
    return apiError(400, "INVALID_INPUT", "Provide a valid category name or archived state.");
  }
  const operation = `category.update:${categoryId}`;
  const hash = createHash("sha256").update(JSON.stringify({ name, archived: input.archived })).digest("hex");
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
      const current = await client.query(
        `SELECT id, name, type, archived FROM categories
          WHERE organisation_id = $1 AND id = $2 FOR UPDATE`,
        [organisationId, categoryId],
      );
      if (!current.rowCount) return { missing: true as const };
      const before = current.rows[0];
      const result = await client.query(
        `UPDATE categories SET name = $3, archived = $4
          WHERE organisation_id = $1 AND id = $2
          RETURNING id, name, type, archived`,
        [organisationId, categoryId, name ?? before.name, input.archived ?? before.archived],
      );
      const data = result.rows[0];
      await client.query(
        `INSERT INTO audit_events (organisation_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
         VALUES ($1, $2, 'category.updated', 'category', $3, $4::jsonb, $5::jsonb)`,
        [organisationId, userId, categoryId, JSON.stringify(before), JSON.stringify(data)],
      );
      await client.query(
        `INSERT INTO idempotency_records (organisation_id, operation, idempotency_key, request_hash, response_data)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [organisationId, operation, key, hash, JSON.stringify(data)],
      );
      return { conflict: false as const, replayed: false, data };
    }, "category:manage");
    if ("missing" in outcome) return apiError(404, "NOT_FOUND", "Category not found.");
    if (outcome.conflict) return apiError(409, "IDEMPOTENCY_KEY_REUSED", "This idempotency key was used for a different category change.");
    return NextResponse.json({ data: outcome.data, replayed: outcome.replayed }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") return apiError(409, "DUPLICATE_CATEGORY", "That category name already exists in this workspace.");
    return apiFailure(error, "CATEGORY_UPDATE_FAILED", "Could not update this category.");
  }
}
