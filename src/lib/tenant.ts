/**
 * Tenant Isolation & Role-Based Authorization (PRD Section 7 & UI/UX Section 9.10).
 * Note: "Staff" scoped role is intentionally gated until fine-grained task/record scope is enabled.
 */
export type Role = "owner" | "admin" | "bookkeeper" | "accountant";

export type Capability =
  | "workspace:manage_settings"
  | "workspace:manage_members"
  | "dashboard:view"
  | "transaction:create_edit"
  | "transaction:post"
  | "transaction:reverse"
  | "import:run"
  | "invoice:create_send"
  | "invoice:record_receipt"
  | "bill:create_update"
  | "contact:manage"
  | "tracking_account:manage"
  | "category:manage"
  | "report:view"
  | "report:export"
  | "audit:view_all"
  | "audit:view_own";

export type Membership = {
  id: string;
  invitationId?: string;
  userId: string;
  name: string;
  email: string;
  phone?: string;
  organisationId: string;
  role: Role;
  status: "active" | "invited" | "deactivated" | "expired";
  active: boolean;
  invitedAt: string;
  lastActiveAt?: string;
};

const ROLE_CAPABILITIES: Record<Role, readonly Capability[]> = {
  owner: [
    "workspace:manage_settings",
    "workspace:manage_members",
    "dashboard:view",
    "transaction:create_edit",
    "transaction:post",
    "transaction:reverse",
    "import:run",
    "invoice:create_send",
    "invoice:record_receipt",
    "bill:create_update",
    "contact:manage",
    "tracking_account:manage",
    "category:manage",
    "report:view",
    "report:export",
    "audit:view_all",
    "audit:view_own",
  ],
  admin: [
    "workspace:manage_settings",
    "workspace:manage_members",
    "dashboard:view",
    "transaction:create_edit",
    "transaction:post",
    "transaction:reverse",
    "import:run",
    "invoice:create_send",
    "invoice:record_receipt",
    "bill:create_update",
    "contact:manage",
    "tracking_account:manage",
    "category:manage",
    "report:view",
    "report:export",
    "audit:view_all",
    "audit:view_own",
  ],
  bookkeeper: [
    "dashboard:view",
    "transaction:create_edit",
    "transaction:post",
    "transaction:reverse",
    "import:run",
    "invoice:create_send",
    "invoice:record_receipt",
    "bill:create_update",
    "contact:manage",
    "tracking_account:manage",
    "category:manage",
    "report:view",
    "report:export",
    "audit:view_own",
  ],
  accountant: [
    "dashboard:view",
    "report:view",
    "report:export",
    "audit:view_all",
  ],
};

export function hasCapability(role: Role, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role]?.includes(capability) ?? false;
}

export const ROLE_DESCRIPTIONS: Record<
  Role,
  { label: string; summary: string; allowed: string[]; restricted: string[] }
> = {
  owner: {
    label: "Owner",
    summary: "Full workspace control, team management, settings, corrections, and exports.",
    allowed: [
      "View Money Brief, dashboard, reports, and full audit trail",
      "Create, post, and reverse/correct transactions and imports",
      "Manage invoices, receipts, supplier bills, and contacts",
      "Invite or deactivate members and manage business settings",
    ],
    restricted: ["None (highest workspace privilege)"],
  },
  admin: {
    label: "Admin",
    summary: "Day-to-day workspace management, member administration, and full financial operations.",
    allowed: [
      "Manage members, categories, tracking labels, and settings",
      "Create, post, and reverse transactions with mandatory reason",
      "Create/send invoices, record receipts, and export reports",
    ],
    restricted: ["Cannot delete workspace or transfer primary ownership"],
  },
  bookkeeper: {
    label: "Bookkeeper",
    summary: "Captures transactions, runs CSV imports, manages invoices/bills, and prepares reports.",
    allowed: [
      "Create, post, and request/execute corrections on transactions",
      "Upload and commit CSV imports with duplicate resolution",
      "Create invoices, record receipts, and manage supplier bills",
      "Export CSV/PDF summaries and view import/own audit history",
    ],
    restricted: ["Cannot invite or deactivate users", "Cannot alter core workspace settings"],
  },
  accountant: {
    label: "External Accountant",
    summary: "Read-only access to financial records, period summaries, exports, and audit history.",
    allowed: [
      "View Overview, Money Brief, Transactions, Invoices, and Cash Flow",
      "Generate and export CSV/PDF reports for period close and tax review",
      "Inspect full audit trail and record provenance",
    ],
    restricted: [
      "Cannot create, edit, post, or reverse transactions or invoices",
      "Cannot run CSV imports or manage team members",
    ],
  },
};

export async function requireOrganisationAccess(
  userId: string,
  organisationId: string,
  loadMembership: (userId: string, organisationId: string) => Promise<Membership | null>,
  requiredCapability?: Capability,
): Promise<Membership> {
  const membership = await loadMembership(userId, organisationId);
  if (
    !membership ||
    !membership.active ||
    membership.status !== "active" ||
    membership.userId !== userId ||
    membership.organisationId !== organisationId
  ) {
    throw new Error("Forbidden: No active membership in this business workspace");
  }
  if (requiredCapability && !hasCapability(membership.role, requiredCapability)) {
    throw new Error(`Forbidden: Role '${membership.role}' lacks '${requiredCapability}' permission`);
  }
  return membership;
}
