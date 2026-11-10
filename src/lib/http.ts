import { NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { hasCapability, type Capability, type Role } from "@/lib/tenant";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function authenticatedUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

/**
 * Run all SQL for a request on one transaction-pooler connection. The user and
 * active organisation context is transaction-local and consumed by Postgres
 * RLS policies. The application still performs membership and capability checks.
 */
export async function withUserContext<T>(
  userId: string,
  organisationId: string | null,
  task: (client: PoolClient) => Promise<T>,
  capability?: Capability,
): Promise<T> {
  if (organisationId && !isUuid(organisationId)) {
    throw new ApiError(404, "NOT_FOUND", "Workspace not found.");
  }

  const client = await getDb().connect();
  let open = false;
  try {
    await client.query("BEGIN");
    open = true;
    await client.query(
      "SELECT set_config('app.user_id', $1, true), set_config('app.organisation_id', $2, true)",
      [userId, organisationId ?? ""],
    );
    await client.query("SET LOCAL ROLE ledgerly_app");

    if (organisationId) {
      const membership = await client.query<{ role: Role }>(
        `SELECT role FROM memberships
          WHERE user_id = $1 AND organisation_id = $2 AND status = 'active'`,
        [userId, organisationId],
      );
      if (!membership.rowCount) {
        throw new ApiError(404, "NOT_FOUND", "Workspace not found.");
      }
      if (capability && !hasCapability(membership.rows[0].role, capability)) {
        throw new ApiError(403, "FORBIDDEN", "Your role cannot perform this action.");
      }
    }

    const value = await task(client);
    await client.query("COMMIT");
    open = false;
    return value;
  } catch (error) {
    if (open) {
      try { await client.query("ROLLBACK"); } catch { /* preserve the original error */ }
    }
    throw error;
  } finally {
    client.release();
  }
}

export function apiError(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export function apiFailure(error: unknown, fallbackCode: string, fallbackMessage: string) {
  if (error instanceof ApiError) return apiError(error.status, error.code, error.message);
  return apiError(503, fallbackCode, fallbackMessage);
}

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export { parsePositiveKobo } from "@/lib/financial-backend";
