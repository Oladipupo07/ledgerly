import { NextRequest, NextResponse } from "next/server";
import { hasCapability, type Role } from "@/lib/tenant";
import { authenticatedUserId, apiError, apiFailure, withUserContext } from "@/lib/http";
import { csvCell } from "@/lib/csv";

export const runtime = "nodejs";
type Context = { params: Promise<{ organisationId: string }> };
type ReportType = "income-expense" | "cash-movement" | "receivables" | "payables";
function validDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
export async function GET(request: NextRequest, context: Context) {
  const userId = await authenticatedUserId();
  if (!userId) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
  const { organisationId } = await context.params;
  const params = new URL(request.url).searchParams;
  const type = params.get("type") as ReportType | null;
  const from = params.get("from");
  const to = params.get("to");
  const csv = params.get("format") === "csv";
  if (!type || !["income-expense", "cash-movement", "receivables", "payables"].includes(type) ||
      !validDate(from) || !validDate(to) || from > to || (params.has("format") && !csv)) {
    return apiError(400, "INVALID_REPORT_FILTER", "Choose a supported report, date range, and optional CSV format.");
  }
  try {
    const rows = await withUserContext(userId, organisationId, async (client) => {
      const member = await client.query<{ role: Role }>(`SELECT role FROM memberships WHERE organisation_id = $1 AND user_id = $2 AND status = 'active'`, [organisationId, userId]);
      if (!hasCapability(member.rows[0].role, csv ? "report:export" : "report:view")) return { forbidden: true as const, rows: [] as Record<string, unknown>[] };
      if (type === "income-expense") {
        const result = await client.query(
          `SELECT CASE WHEN t.direction = 'inflow' THEN 'income' ELSE 'expense' END AS type,
                  COALESCE(c.name, 'Uncategorised') AS category,
                  count(*)::integer AS transactions, sum(t.amount_kobo)::text AS "amountKobo"
             FROM transactions t LEFT JOIN categories c ON c.organisation_id = t.organisation_id AND c.id = t.category_id
            WHERE t.organisation_id = $1 AND t.status = 'posted' AND t.type <> 'transfer'
              AND t.transaction_date BETWEEN $2::date AND $3::date
            GROUP BY t.direction, c.name ORDER BY t.direction, c.name`, [organisationId, from, to]);
        return { forbidden: false as const, rows: result.rows };
      }
      if (type === "cash-movement") {
        const result = await client.query(
          `WITH movements AS (
             SELECT t.transaction_date, a.name AS account, t.amount_kobo::numeric * CASE WHEN t.direction = 'inflow' THEN 1 ELSE -1 END AS signed_kobo
               FROM transactions t JOIN tracking_accounts a ON a.organisation_id = t.organisation_id AND a.id = t.tracking_account_id
              WHERE t.organisation_id = $1 AND t.status = 'posted' AND t.type <> 'transfer' AND t.transaction_date BETWEEN $2::date AND $3::date
             UNION ALL
             SELECT t.transaction_date, destination.name, t.amount_kobo::numeric
               FROM transactions t JOIN tracking_accounts destination ON destination.organisation_id = t.organisation_id AND destination.id = t.transfer_to_account_id
              WHERE t.organisation_id = $1 AND t.status = 'posted' AND t.type = 'transfer' AND t.transaction_date BETWEEN $2::date AND $3::date
             UNION ALL
             SELECT t.transaction_date, source.name, -t.amount_kobo::numeric
               FROM transactions t JOIN tracking_accounts source ON source.organisation_id = t.organisation_id AND source.id = t.tracking_account_id
              WHERE t.organisation_id = $1 AND t.status = 'posted' AND t.type = 'transfer' AND t.transaction_date BETWEEN $2::date AND $3::date
           ) SELECT transaction_date::text AS date, account, sum(signed_kobo)::text AS "netMovementKobo"
               FROM movements GROUP BY transaction_date, account ORDER BY transaction_date, account`, [organisationId, from, to]);
        return { forbidden: false as const, rows: result.rows };
      }
      if (type === "receivables") {
        const result = await client.query(
          `WITH invoice_totals AS (
             SELECT i.id, i.invoice_number AS "invoiceNumber", c.name AS customer, i.issue_date::text AS "issueDate", i.due_date::text AS "dueDate",
                    greatest(0, round((coalesce(sum(round(l.quantity * l.unit_price_kobo)), 0) - i.discount_kobo) * (1 + coalesce(i.tax_rate_percent, 0) / 100)))::bigint AS total
               FROM invoices i JOIN contacts c ON c.organisation_id = i.organisation_id AND c.id = i.customer_id
               LEFT JOIN invoice_lines l ON l.organisation_id = i.organisation_id AND l.invoice_id = i.id
              WHERE i.organisation_id = $1 AND i.status NOT IN ('cancelled', 'disputed') AND i.issue_date BETWEEN $2::date AND $3::date
              GROUP BY i.id, c.name
           ), received AS (
             SELECT invoice_id, sum(amount_kobo)::bigint AS total FROM invoice_receipts WHERE organisation_id = $1 GROUP BY invoice_id
           ) SELECT t."invoiceNumber", t.customer, t."issueDate", t."dueDate", t.total::text AS "totalKobo",
                    coalesce(r.total, 0)::text AS "receivedKobo", greatest(0, t.total - coalesce(r.total, 0))::text AS "outstandingKobo"
               FROM invoice_totals t LEFT JOIN received r ON r.invoice_id = t.id
              WHERE t.total > coalesce(r.total, 0) ORDER BY t."dueDate", t."invoiceNumber"`, [organisationId, from, to]);
        return { forbidden: false as const, rows: result.rows };
      }
      const result = await client.query(
        `SELECT b.bill_number AS "billNumber", c.name AS supplier, b.bill_date::text AS "billDate", b.due_date::text AS "dueDate",
                b.amount_kobo::text AS "amountKobo", b.paid_amount_kobo::text AS "paidKobo",
                (b.amount_kobo - b.paid_amount_kobo)::text AS "outstandingKobo"
           FROM supplier_bills b JOIN contacts c ON c.organisation_id = b.organisation_id AND c.id = b.supplier_id
          WHERE b.organisation_id = $1 AND b.status <> 'cancelled' AND b.bill_date BETWEEN $2::date AND $3::date
            AND b.amount_kobo > b.paid_amount_kobo ORDER BY b.due_date, b.bill_number`, [organisationId, from, to]);
      return { forbidden: false as const, rows: result.rows };
    });
    if (rows.forbidden) return apiError(403, "FORBIDDEN", "Your role cannot access this report.");
    if (csv) {
      const keys = rows.rows.length ? Object.keys(rows.rows[0]) : ["No data for selected period"];
      const content = [keys.map(csvCell).join(","), ...rows.rows.map((row) => keys.map((key) => csvCell(row[key])).join(","))].join("\r\n");
      return new NextResponse(content, { headers: {
        "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="ledgerly-${type}-${from}-${to}.csv"`,
        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      } });
    }
    return NextResponse.json({ data: { type, from, to, generatedAt: new Date().toISOString(), rows: rows.rows } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiFailure(error, "REPORT_FAILED", "Could not generate this report."); }
}
