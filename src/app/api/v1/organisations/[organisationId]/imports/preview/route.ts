import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { normalizeCsvRow, parseCsv, type CsvMapping, type CsvOptions } from "@/lib/csv-import";
import { authenticatedUserId, apiError, apiFailure, isSameOrigin, isUuid, withUserContext } from "@/lib/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ organisationId: string }> };

export async function POST(request: NextRequest, context: Context) {
  if (!isSameOrigin(request)) return apiError(403, "INVALID_ORIGIN", "Request origin could not be verified.");
  const userId = await authenticatedUserId();
  if (!userId) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
  const { organisationId } = await context.params;
  const key = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) return apiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Provide a valid Idempotency-Key header.");
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 5_000_000) return apiError(413, "CSV_TOO_LARGE", "CSV files must be 5 MB or smaller.");
  let body: unknown;
  try { body = await request.json(); } catch { return apiError(400, "INVALID_JSON", "Provide a valid JSON request."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return apiError(400, "INVALID_INPUT", "CSV content and column mapping are required.");
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((field) => !["fileName", "csv", "trackingAccountId", "mapping", "options"].includes(field))) return apiError(400, "UNKNOWN_FIELD", "The request contains an unsupported field.");
  const fileName = typeof input.fileName === "string" ? input.fileName.trim().slice(0, 240) : "statement.csv";
  const csvText = input.csv;
  if (typeof csvText !== "string" || Buffer.byteLength(csvText, "utf8") > 5_000_000) return apiError(413, "CSV_TOO_LARGE", "CSV content must be 5 MB or smaller.");
  if (typeof input.trackingAccountId !== "string" || !isUuid(input.trackingAccountId)) return apiError(400, "INVALID_ACCOUNT", "Choose a valid tracking label.");
  if (!input.mapping || typeof input.mapping !== "object" || Array.isArray(input.mapping) ||
      !input.options || typeof input.options !== "object" || Array.isArray(input.options)) return apiError(400, "INVALID_MAPPING", "Choose CSV columns and parsing options.");
  const mapping = input.mapping as Record<string, unknown>;
  const options = input.options as Record<string, unknown>;
  if (Object.keys(mapping).some((field) => !["date", "description", "amount", "direction", "reference"].includes(field)) ||
      !Number.isInteger(mapping.date) || !Number.isInteger(mapping.description) || !Number.isInteger(mapping.amount) ||
      (mapping.direction !== undefined && !Number.isInteger(mapping.direction)) || (mapping.reference !== undefined && !Number.isInteger(mapping.reference)) ||
      !["iso", "dmy", "mdy"].includes(String(options.dateFormat)) || ![".", ","].includes(String(options.decimalSeparator))) {
    return apiError(400, "INVALID_MAPPING", "Choose valid date, description, amount, date format, and decimal separator settings.");
  }
  const indexes = Object.values(mapping);
  if (new Set(indexes).size !== indexes.length || indexes.some((index) => (index as number) < 0 || (index as number) > 99)) return apiError(400, "INVALID_MAPPING", "Each CSV field must use a different valid column.");
  const parsed = parseCsv(csvText);
  if (!parsed || parsed.length < 2 || parsed.length > 1001) return apiError(400, "INVALID_CSV", "Provide a valid CSV with a header and up to 1,000 data rows.");
  const headers = parsed[0].map((name) => name.trim().slice(0, 120));
  const typedMapping = mapping as unknown as CsvMapping;
  const typedOptions = options as unknown as CsvOptions;
  if (indexes.some((index) => (index as number) >= headers.length)) return apiError(400, "INVALID_MAPPING", "A selected column is outside the CSV header.");
  const operation = "import.preview";
  const contentHash = createHash("sha256").update(JSON.stringify({ csvText, trackingAccountId: input.trackingAccountId, mapping, options })).digest("hex");
  try {
    const outcome = await withUserContext(userId, organisationId, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${organisationId}:${operation}:${key}`]);
      const prior = await client.query(`SELECT request_hash, response_data FROM idempotency_records WHERE organisation_id = $1 AND operation = $2 AND idempotency_key = $3`, [organisationId, operation, key]);
      if (prior.rowCount) return prior.rows[0].request_hash === contentHash
        ? { conflict: false as const, replayed: true, data: prior.rows[0].response_data }
        : { conflict: true as const };
      const account = await client.query(`SELECT id FROM tracking_accounts WHERE organisation_id = $1 AND id = $2 AND archived = false`, [organisationId, input.trackingAccountId]);
      if (!account.rowCount) return { invalidAccount: true as const };
      const batchId = randomUUID();
      const prepared = parsed.slice(1).map((cells, index) => ({ rowNumber: index + 2, data: normalizeCsvRow(cells, typedMapping, typedOptions) }));
      const batch = await client.query(
        `INSERT INTO import_batches (id, organisation_id, file_name, tracking_account_id, total_rows, error_count, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING uploaded_at AS "uploadedAt"`,
        [batchId, organisationId, fileName || "statement.csv", input.trackingAccountId, prepared.length, prepared.filter((row) => !row.data).length, userId],
      );
      const seenHashes = new Set<string>();
      const rows = [];
      for (const item of prepared) {
        if (!item.data) {
          const inserted = await client.query(
            `INSERT INTO import_rows (organisation_id, batch_id, row_number, raw_data, outcome, issue)
             VALUES ($1, $2, $3, '{}'::jsonb, 'error', 'Could not parse row using the selected columns and formats.')
             RETURNING id`, [organisationId, batchId, item.rowNumber]);
          rows.push({ id: inserted.rows[0].id, rowNumber: item.rowNumber, outcome: "error", issue: "Could not parse row." });
          continue;
        }
        const hash = createHash("sha256").update(JSON.stringify({ ...item.data, trackingAccountId: input.trackingAccountId })).digest("hex");
        const duplicate = seenHashes.has(hash) || Boolean((await client.query(
          `SELECT 1 FROM transactions WHERE organisation_id = $1 AND transaction_date = $2::date AND description = $3
             AND amount_kobo = $4::bigint AND direction = $5 AND tracking_account_id = $6 AND status = 'posted' LIMIT 1`,
          [organisationId, item.data.date, item.data.description, item.data.amountKobo, item.data.direction, input.trackingAccountId],
        )).rowCount);
        seenHashes.add(hash);
        const outcome = duplicate ? "duplicate" : "preview";
        const inserted = await client.query(
          `INSERT INTO import_rows (organisation_id, batch_id, row_number, raw_data, normalized_hash, outcome, issue)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7) RETURNING id`,
          [organisationId, batchId, item.rowNumber, JSON.stringify(item.data), hash, outcome, duplicate ? "Matches a previous or repeated transaction; confirm inclusion if intentional." : null],
        );
        rows.push({ id: inserted.rows[0].id, rowNumber: item.rowNumber, ...item.data, outcome, issue: duplicate ? "Possible duplicate." : null });
      }
      const data = { batchId, fileName, trackingAccountId: input.trackingAccountId, totalRows: prepared.length, errorCount: prepared.filter((row) => !row.data).length, uploadedAt: batch.rows[0].uploadedAt, headers, rows };
      await client.query(
        `INSERT INTO audit_events (organisation_id, actor_user_id, action, entity_type, entity_id, after_data)
         VALUES ($1, $2, 'import.preview_created', 'import_batch', $3, $4::jsonb)`,
        [organisationId, userId, batchId, JSON.stringify({ fileName, totalRows: prepared.length, errorCount: data.errorCount })],
      );
      await client.query(`INSERT INTO idempotency_records (organisation_id, operation, idempotency_key, request_hash, response_data) VALUES ($1, $2, $3, $4, $5::jsonb)`, [organisationId, operation, key, contentHash, JSON.stringify(data)]);
      return { conflict: false as const, replayed: false, data };
    }, "import:run");
    if ("invalidAccount" in outcome) return apiError(400, "TRACKING_LABEL_UNAVAILABLE", "Choose an active tracking label in this workspace.");
    if (outcome.conflict) return apiError(409, "IDEMPOTENCY_KEY_REUSED", "This idempotency key was used for different import content.");
    return NextResponse.json({ data: outcome.data, replayed: outcome.replayed }, { status: outcome.replayed ? 200 : 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiFailure(error, "IMPORT_PREVIEW_FAILED", "Could not prepare this CSV import."); }
}
