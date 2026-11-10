import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { apiError, apiFailure, isSameOrigin, withUserContext } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
  try {
    const rows = await withUserContext(userId, null, async (client) => {
      const result = await client.query(
        `SELECT o.id, o.display_name AS "displayName", o.legal_name AS "legalName",
                o.business_type AS "businessType", o.state_city AS "stateCity",
                o.fiscal_year_start_month AS "financialYearStartMonth", o.tax_id AS "taxId",
                o.low_cash_threshold_kobo::text AS "lowCashThresholdKobo",
                o.notification_prefs AS "notificationPrefs",
                o.dismissed_observations AS "dismissedObservations",
                o.reviewed_observations AS "reviewedObservations",
                o.timezone, o.base_currency AS "baseCurrency", m.role
           FROM memberships m JOIN organisations o ON o.id = m.organisation_id
          WHERE m.user_id = $1 AND m.status = 'active'
          ORDER BY o.display_name`,
        [userId],
      );
      return result.rows;
    });
    return NextResponse.json({ data: rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiFailure(error, "BACKEND_UNAVAILABLE", "Workspace storage is unavailable.");
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return apiError(403, "INVALID_ORIGIN", "Request origin could not be verified.");
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");

  let body: unknown;
  try { body = await request.json(); } catch { return apiError(400, "INVALID_JSON", "Provide a valid JSON request."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return apiError(400, "INVALID_INPUT", "Workspace details are required.");
  }
  const input = body as Record<string, unknown>;
  const legalName = typeof input.legalName === "string" ? input.legalName.trim() : "";
  const displayName = typeof input.displayName === "string" ? input.displayName.trim() : "";
  const businessType = typeof input.businessType === "string" ? input.businessType.trim() : "";
  const stateCity = typeof input.stateCity === "string" ? input.stateCity.trim() : "";
  const fiscalMonth = input.fiscalYearStartMonth === undefined ? 1 : input.fiscalYearStartMonth;
  const allowedTypes = new Set([
    "Service & Creative", "Retail & Trade", "Distribution",
    "Light Manufacturing", "Professional Services",
  ]);
  if (
    !legalName || legalName.length > 160 || !displayName || displayName.length > 100 ||
    !allowedTypes.has(businessType) || stateCity.length > 120 ||
    typeof fiscalMonth !== "number" || !Number.isInteger(fiscalMonth) || fiscalMonth < 1 || fiscalMonth > 12
  ) {
    return apiError(400, "INVALID_INPUT", "Provide a valid business name, type, location, and financial year start month.");
  }
  const taxId = typeof input.taxId === "string" ? input.taxId.trim() : null;
  if (taxId && taxId.length > 80) return apiError(400, "INVALID_INPUT", "Tax identifier must be 80 characters or fewer.");

  try {
    const data = await withUserContext(userId, null, async (client) => {
      await client.query(
        `INSERT INTO app_users (id, email, display_name) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, display_name = EXCLUDED.display_name`,
        [userId, session?.user?.email ?? null, session?.user?.name ?? ""],
      );
      const created = await client.query(
        `INSERT INTO organisations
           (owner_user_id, legal_name, display_name, business_type, state_city, fiscal_year_start_month, tax_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [userId, legalName, displayName, businessType, stateCity, fiscalMonth, taxId],
      );
      const organisationId = created.rows[0].id as string;
      await client.query(
        "SELECT set_config('app.organisation_id', $1, true)",
        [organisationId],
      );
      await client.query(
        `INSERT INTO memberships (user_id, organisation_id, role, status)
         VALUES ($1, $2, 'owner', 'active')`,
        [userId, organisationId],
      );
      const defaultCategories: Array<[string, "income" | "expense" | "both", boolean]> = [
        ["Client Retainers & Sales", "income", true],
        ["Product & Merchandise Revenue", "income", true],
        ["Supplier Inventory & COGS", "expense", true],
        ["Power, Diesel & Utilities", "expense", true],
        ["Logistics, Dispatch & Transport", "expense", true],
        ["Staff Salaries & Operations", "expense", true],
        ["Bank & POS Charges", "expense", true],
        ["General Adjustments & Refunds", "both", true],
      ];
      for (const [catName, catType, isSys] of defaultCategories) {
        await client.query(
          `INSERT INTO categories (organisation_id, name, type, is_system)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING`,
          [organisationId, catName, catType, isSys],
        );
      }
      await client.query(
        `INSERT INTO tracking_accounts
           (organisation_id, name, kind, masked_ref, opening_balance_kobo, opening_balance_date, opening_balance_recorded_by)
         VALUES ($1, 'Primary Business Bank Label', 'bank_label', 'Non-custodial record', 0, CURRENT_DATE, $2)
         ON CONFLICT DO NOTHING`,
        [organisationId, userId],
      );
      await client.query(
        `INSERT INTO audit_events (organisation_id, actor_user_id, action, entity_type, entity_id, after_data)
         VALUES ($1, $2, 'workspace.created', 'workspace', $1::text, jsonb_build_object('displayName', $3))`,
        [organisationId, userId, displayName],
      );
      return { id: organisationId, displayName, legalName, role: "owner" };
    });
    return NextResponse.json({ data }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiFailure(error, "WORKSPACE_CREATE_FAILED", "Could not create the workspace. Please retry.");
  }
}
