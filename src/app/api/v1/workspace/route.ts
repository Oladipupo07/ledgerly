import { NextRequest, NextResponse } from "next/server";
import { computeDashboardSummary, buildMoneyBrief } from "@/lib/domain";
import { createInitialWorkspaceState } from "@/lib/seed";
import { requireOrganisationAccess, Capability } from "@/lib/tenant";

// In-memory server state for API route requests during dev/runtime
let serverWorkspaceState = createInitialWorkspaceState();

export async function GET(req: NextRequest) {
  try {
    const userId = req.headers.get("x-ledgerly-user-id") ?? "usr-amina";
    const orgId = req.headers.get("x-ledgerly-org-id") ?? serverWorkspaceState.workspace.id;

    const membership = await requireOrganisationAccess(
      userId,
      orgId,
      async (uId, oId) =>
        serverWorkspaceState.members.find(
          (m) => m.userId === uId && m.organisationId === oId,
        ) ?? null,
      "dashboard:view",
    );

    const summary = computeDashboardSummary(serverWorkspaceState, 30);
    const moneyBrief = buildMoneyBrief(serverWorkspaceState, 30);

    return NextResponse.json({
      meta: {
        correlationId: `req-${Date.now()}`,
        asOfDate: "2026-11-06",
        currency: "NGN",
        timezone: "Africa/Lagos",
        activeRole: membership.role,
      },
      data: {
        workspace: serverWorkspaceState.workspace,
        summary,
        moneyBrief,
        state: serverWorkspaceState,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized request";
    return NextResponse.json(
      {
        error: {
          code: "FORBIDDEN",
          message,
          correlationId: `err-${Date.now()}`,
        },
      },
      { status: 403 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const userId = req.headers.get("x-ledgerly-user-id") ?? body.userId ?? "usr-amina";
    const orgId = req.headers.get("x-ledgerly-org-id") ?? serverWorkspaceState.workspace.id;
    const capability = (body.requiredCapability as Capability | undefined) ?? "dashboard:view";

    const membership = await requireOrganisationAccess(
      userId,
      orgId,
      async (uId, oId) =>
        serverWorkspaceState.members.find(
          (m) => m.userId === uId && m.organisationId === oId,
        ) ?? null,
      capability,
    );

    if (body.action === "reset_demo") {
      serverWorkspaceState = createInitialWorkspaceState();
    } else if (body.nextState) {
      serverWorkspaceState = body.nextState;
    }

    return NextResponse.json({
      meta: {
        correlationId: `mut-${Date.now()}`,
        actor: membership.name,
        role: membership.role,
      },
      data: serverWorkspaceState,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Operation failed";
    return NextResponse.json(
      {
        error: {
          code: message.startsWith("Forbidden") ? "FORBIDDEN" : "VALIDATION_ERROR",
          message,
          correlationId: `err-${Date.now()}`,
        },
      },
      { status: message.startsWith("Forbidden") ? 403 : 400 },
    );
  }
}

