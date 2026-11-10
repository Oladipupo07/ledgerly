import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authenticatedUserId, apiError, apiFailure, isSameOrigin, withUserContext } from "@/lib/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ organisationId: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  if (!isSameOrigin(request)) return apiError(403, "INVALID_ORIGIN", "Request origin could not be verified.");
  const userId = await authenticatedUserId();
  if (!userId) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
  const { organisationId } = await context.params;
  const key = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) return apiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Provide a valid Idempotency-Key header.");
  let body: unknown;
  try { body = await request.json(); } catch { return apiError(400, "INVALID_JSON", "Provide a valid JSON request."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return apiError(400, "INVALID_INPUT", "Workspace settings are required.");
  const input = body as Record<string, unknown>;
  const fields = [
    "legalName",
    "displayName",
    "stateCity",
    "taxId",
    "lowCashThresholdKobo",
    "notificationPrefs",
    "dismissedObservations",
    "reviewedObservations",
  ];
  if (Object.keys(input).some((field) => !fields.includes(field))) return apiError(400, "UNKNOWN_FIELD", "The request contains an unsupported field.");

  const hasProfileFields =
    "legalName" in input ||
    "displayName" in input ||
    "stateCity" in input ||
    "taxId" in input ||
    "lowCashThresholdKobo" in input;
  const legalName = typeof input.legalName === "string" ? input.legalName.trim() : "";
  const displayName = typeof input.displayName === "string" ? input.displayName.trim() : "";
  const stateCity = typeof input.stateCity === "string" ? input.stateCity.trim() : "";
  const taxId = typeof input.taxId === "string" ? input.taxId.trim() : "";
  const threshold = input.lowCashThresholdKobo;

  if (
    hasProfileFields &&
    (!legalName ||
      legalName.length > 160 ||
      !displayName ||
      displayName.length > 100 ||
      stateCity.length > 120 ||
      taxId.length > 80 ||
      typeof threshold !== "string" ||
      !/^\d{1,16}$/.test(threshold) ||
      BigInt(threshold) > 9_000_000_000_000_000n)
  ) {
    return apiError(400, "INVALID_INPUT", "Provide valid workspace details and a non-negative whole-kobo alert threshold.");
  }

  const notificationPrefs =
    input.notificationPrefs && typeof input.notificationPrefs === "object" && !Array.isArray(input.notificationPrefs)
      ? input.notificationPrefs
      : undefined;
  const dismissedObservations =
    Array.isArray(input.dismissedObservations) && input.dismissedObservations.every((v) => typeof v === "string" && v.length <= 120)
      ? input.dismissedObservations
      : undefined;
  const reviewedObservations =
    Array.isArray(input.reviewedObservations) && input.reviewedObservations.every((v) => typeof v === "string" && v.length <= 120)
      ? input.reviewedObservations
      : undefined;

  if (!hasProfileFields && !notificationPrefs && !dismissedObservations && !reviewedObservations) {
    return apiError(400, "INVALID_INPUT", "Provide workspace settings, notification preferences, or observation states to update.");
  }

  const normalized = {
    ...(hasProfileFields ? { legalName, displayName, stateCity, taxId: taxId || null, lowCashThresholdKobo: threshold } : {}),
    ...(notificationPrefs ? { notificationPrefs } : {}),
    ...(dismissedObservations ? { dismissedObservations } : {}),
    ...(reviewedObservations ? { reviewedObservations } : {}),
  };
  const hash = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
  const requiredCap = hasProfileFields || notificationPrefs ? "workspace:manage_settings" : undefined;
  try {
    const outcome = await withUserContext(userId, organisationId, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${organisationId}:workspace.settings:${key}`]);
      const prior = await client.query(`SELECT request_hash, response_data FROM idempotency_records WHERE organisation_id = $1 AND operation = 'workspace.settings' AND idempotency_key = $2`, [organisationId, key]);
      if (prior.rowCount) return prior.rows[0].request_hash === hash ? { conflict: false as const, data: prior.rows[0].response_data } : { conflict: true as const };
      const current = await client.query(
        `SELECT legal_name AS "legalName", display_name AS "displayName", state_city AS "stateCity",
                tax_id AS "taxId", low_cash_threshold_kobo::text AS "lowCashThresholdKobo",
                notification_prefs AS "notificationPrefs",
                dismissed_observations AS "dismissedObservations",
                reviewed_observations AS "reviewedObservations"
           FROM organisations WHERE id = $1 FOR UPDATE`,
        [organisationId],
      );
      if (!current.rowCount) return { missing: true as const };
      const row = current.rows[0];
      const updated = await client.query(
        `UPDATE organisations
            SET legal_name = $2,
                display_name = $3,
                state_city = $4,
                tax_id = $5,
                low_cash_threshold_kobo = $6,
                notification_prefs = $7::jsonb,
                dismissed_observations = $8::jsonb,
                reviewed_observations = $9::jsonb,
                updated_at = now()
          WHERE id = $1
          RETURNING id, legal_name AS "legalName", display_name AS "displayName", state_city AS "stateCity",
                    tax_id AS "taxId", low_cash_threshold_kobo::text AS "lowCashThresholdKobo",
                    notification_prefs AS "notificationPrefs",
                    dismissed_observations AS "dismissedObservations",
                    reviewed_observations AS "reviewedObservations"`,
        [
          organisationId,
          hasProfileFields ? legalName : row.legalName,
          hasProfileFields ? displayName : row.displayName,
          hasProfileFields ? stateCity : row.stateCity,
          hasProfileFields ? taxId || null : row.taxId,
          hasProfileFields ? threshold : row.lowCashThresholdKobo,
          JSON.stringify(notificationPrefs ?? row.notificationPrefs ?? {}),
          JSON.stringify(dismissedObservations ?? row.dismissedObservations ?? []),
          JSON.stringify(reviewedObservations ?? row.reviewedObservations ?? []),
        ],
      );
      const data = updated.rows[0];
      await client.query(`INSERT INTO audit_events (organisation_id, actor_user_id, action, entity_type, entity_id, before_data, after_data) VALUES ($1, $2, 'workspace.settings_updated', 'workspace', $3, $4::jsonb, $5::jsonb)`, [organisationId, userId, organisationId, JSON.stringify(row), JSON.stringify(data)]);
      await client.query(`INSERT INTO idempotency_records (organisation_id, operation, idempotency_key, request_hash, response_data) VALUES ($1, 'workspace.settings', $2, $3, $4::jsonb)`, [organisationId, key, hash, JSON.stringify(data)]);
      return { conflict: false as const, data };
    }, requiredCap);
    if ("missing" in outcome) return apiError(404, "WORKSPACE_NOT_FOUND", "Workspace not found.");
    if (outcome.conflict) return apiError(409, "IDEMPOTENCY_KEY_REUSED", "This idempotency key was used for different workspace settings.");
    return NextResponse.json({ data: outcome.data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiFailure(error, "WORKSPACE_SETTINGS_FAILED", "Could not save workspace settings."); }
}
