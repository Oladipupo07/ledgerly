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
        `SELECT b.id,
                b.file_name AS "fileName",
                b.tracking_account_id AS "trackingAccountId",
                COALESCE(NULLIF(u.display_name, ''), u.email, b.uploaded_by) AS "uploadedBy",
                b.uploaded_at AS "uploadedAt",
                b.committed_at AS "committedAt",
                b.total_rows AS "totalRows",
                b.committed_count AS "committedCount",
                b.skipped_count AS "skippedCount",
                b.error_count AS "errorCount",
                b.status,
                COALESCE(rows.items, '[]'::jsonb) AS rows
           FROM import_batches b
           LEFT JOIN app_users u ON u.id = b.uploaded_by
           LEFT JOIN LATERAL (
             SELECT jsonb_agg(
               jsonb_build_object(
                 'id', r.id,
                 'rowNumber', r.row_number,
                 'rawData', r.raw_data,
                 'outcome', r.outcome,
                 'transactionId', r.transaction_id,
                 'issue', r.issue
               ) ORDER BY r.row_number
             ) AS items
               FROM import_rows r
              WHERE r.organisation_id = b.organisation_id AND r.batch_id = b.id
           ) rows ON true
          WHERE b.organisation_id = $1
          ORDER BY b.uploaded_at DESC
          LIMIT 100`,
        [organisationId],
      );
      return result.rows;
    });
    return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiFailure(error, "IMPORTS_UNAVAILABLE", "Import batches are unavailable.");
  }
}

