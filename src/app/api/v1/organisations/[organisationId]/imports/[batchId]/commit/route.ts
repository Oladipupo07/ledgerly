import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authenticatedUserId, apiError, apiFailure, isSameOrigin, isUuid, withUserContext } from "@/lib/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ organisationId: string; batchId: string }> };

export async function POST(request: NextRequest, context: Context) {
  if (!isSameOrigin(request)) return apiError(403, "INVALID_ORIGIN", "Request origin could not be verified.");
  const userId = await authenticatedUserId();
  if (!userId) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
  const { organisationId, batchId } = await context.params;
  if (!isUuid(batchId)) return apiError(404, "IMPORT_NOT_FOUND", "Import batch not found.");
  const key = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) return apiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Provide a valid Idempotency-Key header.");
  let body: unknown;
  try { body = await request.json(); } catch { return apiError(400, "INVALID_JSON", "Provide a valid JSON request."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return apiError(400, "INVALID_INPUT", "Choose an outcome for each valid row.");
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((field) => field !== "items") || !Array.isArray(input.items) || input.items.length > 1000) return apiError(400, "INVALID_INPUT", "Provide a row decision for this import.");
  const decisions = input.items as unknown[];
  const selected = new Map<string, { decision: "include" | "skip"; categoryId: string | null }>();
  for (const item of decisions) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return apiError(400, "INVALID_ROW_DECISION", "Each row decision must be an object.");
    const value = item as Record<string, unknown>;
    if (Object.keys(value).some((field) => !["rowId", "decision", "categoryId"].includes(field)) ||
        typeof value.rowId !== "string" || !isUuid(value.rowId) || !["include", "skip"].includes(String(value.decision)) ||
        (value.categoryId !== undefined && value.categoryId !== null && (typeof value.categoryId !== "string" || !isUuid(value.categoryId))) || selected.has(value.rowId)) {
      return apiError(400, "INVALID_ROW_DECISION", "Provide unique row IDs and include/skip decisions.");
    }
    selected.set(value.rowId, { decision: value.decision as "include" | "skip", categoryId: value.categoryId as string | null | undefined ?? null });
  }
  const operation = `import.commit:${batchId}`;
  const requestHash = createHash("sha256").update(JSON.stringify([...selected.entries()])).digest("hex");
  try {
    const outcome = await withUserContext(userId, organisationId, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${organisationId}:${operation}:${key}`]);
      const prior = await client.query(`SELECT request_hash, response_data FROM idempotency_records WHERE organisation_id = $1 AND operation = $2 AND idempotency_key = $3`, [organisationId, operation, key]);
      if (prior.rowCount) return prior.rows[0].request_hash === requestHash
        ? { conflict: false as const, replayed: true, data: prior.rows[0].response_data }
        : { conflict: true as const };
      const batch = await client.query(`SELECT id, tracking_account_id AS "trackingAccountId", status FROM import_batches WHERE organisation_id = $1 AND id = $2 FOR UPDATE`, [organisationId, batchId]);
      if (!batch.rowCount) return { missing: true as const };
      if (batch.rows[0].status !== "preview") return { invalidState: true as const };
      const rows = await client.query(`SELECT id, raw_data AS data, outcome, row_number AS "rowNumber" FROM import_rows WHERE organisation_id = $1 AND batch_id = $2 ORDER BY row_number FOR UPDATE`, [organisationId, batchId]);
      const validRows = rows.rows.filter((row) => row.outcome !== "error");
      if (selected.size !== validRows.length || validRows.some((row) => !selected.has(row.id))) return { incomplete: true as const };
      let committedCount = 0;
      let skippedCount = 0;
      for (const row of validRows) {
        const choice = selected.get(row.id)!;
        if (choice.decision === "skip") {
          await client.query(`UPDATE import_rows SET outcome = 'skipped' WHERE organisation_id = $1 AND id = $2`, [organisationId, row.id]);
          skippedCount += 1;
          continue;
        }
        const data = row.data as { date?: unknown; description?: unknown; amountKobo?: unknown; direction?: unknown; reference?: unknown };
        if (typeof data.date !== "string" || typeof data.description !== "string" || typeof data.amountKobo !== "string" ||
            !/^(inflow|outflow)$/.test(String(data.direction)) || !/^[1-9]\d{0,15}$/.test(data.amountKobo)) return { malformedRow: true as const };
        if (choice.categoryId) {
          const category = await client.query(`SELECT id FROM categories WHERE organisation_id = $1 AND id = $2 AND archived = false AND (type = 'both' OR type = $3)`, [organisationId, choice.categoryId, data.direction === "inflow" ? "income" : "expense"]);
          if (!category.rowCount) return { invalidCategory: true as const };
        }
        const transactionId = randomUUID();
        const type = data.direction === "inflow" ? "income" : "expense";
        const created = await client.query(
          `INSERT INTO transactions
             (id, organisation_id, transaction_date, description, type, status, amount_kobo, direction,
              category_id, tracking_account_id, reference, source, created_by, idempotency_key, import_batch_id)
           VALUES ($1, $2, $3::date, $4, $5, 'posted', $6::bigint, $7, $8, $9, $10, 'csv_import', $11, $12, $13)
           RETURNING id`,
          [transactionId, organisationId, data.date, data.description, type, data.amountKobo, data.direction,
            choice.categoryId, batch.rows[0].trackingAccountId, typeof data.reference === "string" ? data.reference : null,
            userId, `csv:${batchId}:${row.id}`, batchId],
        );
        await client.query(`UPDATE import_rows SET outcome = 'included', transaction_id = $3 WHERE organisation_id = $1 AND id = $2`, [organisationId, row.id, created.rows[0].id]);
        committedCount += 1;
      }
      await client.query(
        `UPDATE import_batches SET status = 'committed', committed_count = $3, skipped_count = $4, committed_at = now()
          WHERE organisation_id = $1 AND id = $2`, [organisationId, batchId, committedCount, skippedCount],
      );
      await client.query(
        `INSERT INTO audit_events (organisation_id, actor_user_id, action, entity_type, entity_id, after_data)
         VALUES ($1, $2, 'import.committed', 'import_batch', $3, $4::jsonb)`,
        [organisationId, userId, batchId, JSON.stringify({ committedCount, skippedCount, errorCount: rows.rows.length - validRows.length })],
      );
      const data = { batchId, status: "committed", committedCount, skippedCount, errorCount: rows.rows.length - validRows.length };
      await client.query(`INSERT INTO idempotency_records (organisation_id, operation, idempotency_key, request_hash, response_data) VALUES ($1, $2, $3, $4, $5::jsonb)`, [organisationId, operation, key, requestHash, JSON.stringify(data)]);
      return { conflict: false as const, replayed: false, data };
    }, "import:run");
    if ("missing" in outcome) return apiError(404, "IMPORT_NOT_FOUND", "Import batch not found.");
    if ("invalidState" in outcome) return apiError(409, "INVALID_IMPORT_STATE", "Only an uncommitted preview can be committed.");
    if ("incomplete" in outcome) return apiError(400, "ROW_DECISIONS_REQUIRED", "Choose include or skip for every valid preview row.");
    if ("malformedRow" in outcome) return apiError(409, "INVALID_PREVIEW_ROW", "A preview row failed validation. Create a new preview and try again.");
    if ("invalidCategory" in outcome) return apiError(400, "CATEGORY_UNAVAILABLE", "A selected category is unavailable for this row.");
    if (outcome.conflict) return apiError(409, "IDEMPOTENCY_KEY_REUSED", "This idempotency key was used for a different import decision.");
    return NextResponse.json({ data: outcome.data, replayed: outcome.replayed }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiFailure(error, "IMPORT_COMMIT_FAILED", "Could not commit this CSV import."); }
}
