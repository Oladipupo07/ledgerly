import type { WorkspaceState } from "@/lib/domain";
import type { Role } from "@/lib/tenant";

export class ClientApiError extends Error {
  constructor(message: string, public readonly status: number) { super(message); this.name = "ClientApiError"; }
}

export function newIdempotencyKey(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

export async function apiRequest<T>(url: string, init: RequestInit = {}, idempotencyKey?: string): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
  const response = await fetch(url, { ...init, headers, credentials: "same-origin", cache: "no-store" });
  const payload = await response.json().catch(() => null) as { data?: T; error?: { message?: string } } | null;
  if (!response.ok) throw new ClientApiError(payload?.error?.message || `Request failed (${response.status}).`, response.status);
  return payload?.data as T;
}

function asMoney(value: unknown): number {
  const amount = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isSafeInteger(amount) ? amount : 0;
}
function asDate(value: unknown): string { return typeof value === "string" ? value.slice(0, 10) : ""; }
export type WorkspaceOption = {
  id: string;
  displayName: string;
  legalName: string;
  businessType: WorkspaceState["workspace"]["businessType"];
  stateCity: string;
  financialYearStartMonth: number;
  taxId: string | null;
  lowCashThresholdKobo: string;
  notificationPrefs?: Partial<WorkspaceState["notificationPreferences"]>;
  dismissedObservations?: string[];
  reviewedObservations?: string[] | Record<string, string>;
  timezone: string;
  baseCurrency: string;
  role: Role;
};

export async function loadWorkspaceData(option: WorkspaceOption, user: { id: string; name: string; email?: string | null }): Promise<WorkspaceState> {
  const root = `/api/v1/organisations/${encodeURIComponent(option.id)}`;
  const [transactions, invoices, contacts, bills, categories, trackingAccounts, auditPayload, imports, sessions, members, invitations] = await Promise.all([
    apiRequest<Record<string, unknown>[]>(`${root}/transactions`),
    apiRequest<Record<string, unknown>[]>(`${root}/invoices`),
    apiRequest<Record<string, unknown>[]>(`${root}/contacts`),
    apiRequest<Record<string, unknown>[]>(`${root}/supplier-bills`),
    apiRequest<Record<string, unknown>[]>(`${root}/categories`),
    apiRequest<Record<string, unknown>[]>(`${root}/tracking-accounts`),
    apiRequest<{ rows?: Record<string, unknown>[] } | Record<string, unknown>[]>(`${root}/audit-events?limit=100`).catch(() => ({ rows: [] })),
    apiRequest<Record<string, unknown>[]>(`${root}/imports`).catch(() => []),
    apiRequest<Record<string, unknown>[]>(`${root}/sessions`).catch(() => []),
    option.role === "owner" || option.role === "admin" ? apiRequest<Record<string, unknown>[]>(`${root}/members`).catch(() => []) : Promise.resolve([]),
    option.role === "owner" || option.role === "admin" ? apiRequest<Record<string, unknown>[]>(`${root}/members/invitations`).catch(() => []) : Promise.resolve([]),
  ]);
  const auditEvents = Array.isArray(auditPayload)
    ? auditPayload
    : Array.isArray(auditPayload?.rows)
      ? auditPayload.rows
      : [];
  const memberState = members.map((member) => ({
    id: String(member.id), userId: String(member.id), name: String(member.name || member.email || "Workspace member"),
    email: String(member.email || ""), organisationId: option.id, role: member.role as Role,
    status: member.status as "active" | "invited" | "deactivated" | "expired", active: member.status === "active",
    invitedAt: asDate(member.joinedAt) || new Date().toISOString().slice(0, 10),
  }));
  const pendingInvitations = invitations.filter((invite) => invite.status === "pending").map((invite) => ({
    id: `invitation:${String(invite.id)}`, invitationId: String(invite.id), userId: `invitation:${String(invite.id)}`,
    name: String(invite.name || invite.email || "Invited member"), email: String(invite.email || ""), organisationId: option.id,
    role: invite.role as Role, status: "invited" as const, active: false, invitedAt: asDate(invite.createdAt),
  }));
  memberState.push(...pendingInvitations);
  if (!memberState.some((member) => member.userId === user.id)) memberState.unshift({
    id: user.id, userId: user.id, name: user.name || user.email || "You", email: user.email || "",
    organisationId: option.id, role: option.role, status: "active", active: true, invitedAt: new Date().toISOString().slice(0, 10),
  });

  const defaultCategoryId = categories[0]?.id ? String(categories[0].id) : "";
  const reviewedMap: Record<string, string> = {};
  if (Array.isArray(option.reviewedObservations)) {
    for (const id of option.reviewedObservations) {
      if (typeof id === "string") reviewedMap[id] = new Date().toISOString().slice(0, 10);
    }
  } else if (option.reviewedObservations && typeof option.reviewedObservations === "object") {
    Object.assign(reviewedMap, option.reviewedObservations);
  }

  return {
    workspace: {
      id: option.id, displayName: option.displayName, legalName: option.legalName,
      businessType: option.businessType || "Professional Services", stateCity: option.stateCity || "",
      timezone: "Africa/Lagos", baseCurrency: "NGN", financialYearStartMonth: option.financialYearStartMonth || 1,
      taxId: option.taxId || undefined, lowCashThresholdKobo: asMoney(option.lowCashThresholdKobo),
      planName: "MVP", onboardingCompletedSteps: ["workspace_profile", "tracking_account", "categories"], updatedAt: new Date().toISOString(),
    },
    members: memberState,
    trackingAccounts: trackingAccounts.map((account) => ({
      id: String(account.id), organisationId: option.id, name: String(account.name), kind: account.kind as "bank_label" | "pos_label" | "cash_label",
      maskedRef: typeof account.maskedRef === "string" ? account.maskedRef : undefined,
      openingBalanceKobo: asMoney(account.openingBalanceKobo), openingBalanceDate: asDate(account.openingBalanceDate), archived: Boolean(account.archived),
    })),
    categories: categories.map((category) => ({ id: String(category.id), organisationId: option.id, name: String(category.name), type: category.type as "income" | "expense" | "both", archived: Boolean(category.archived) })),
    contacts: contacts.map((contact) => ({
      id: String(contact.id), organisationId: option.id, name: String(contact.name), roles: Array.isArray(contact.roles) ? contact.roles as ("customer" | "supplier")[] : [],
      email: typeof contact.email === "string" ? contact.email : undefined, phone: typeof contact.phone === "string" ? contact.phone : undefined,
      businessId: typeof contact.businessId === "string" ? contact.businessId : undefined, notes: typeof contact.notes === "string" ? contact.notes : undefined,
      status: contact.status === "archived" ? "archived" : "active", createdAt: String(contact.createdAt || ""),
    })),
    transactions: transactions.map((transaction) => ({
      id: String(transaction.id), organisationId: option.id, date: asDate(transaction.date), description: String(transaction.description),
      type: transaction.type as WorkspaceState["transactions"][number]["type"], status: transaction.status as WorkspaceState["transactions"][number]["status"],
      amountKobo: asMoney(transaction.amountKobo), direction: transaction.direction as "inflow" | "outflow",
      categoryId: typeof transaction.categoryId === "string" ? transaction.categoryId : defaultCategoryId, trackingAccountId: String(transaction.trackingAccountId),
      transferToAccountId: typeof transaction.transferToAccountId === "string" ? transaction.transferToAccountId : undefined,
      contactId: typeof transaction.contactId === "string" ? transaction.contactId : undefined, reference: typeof transaction.reference === "string" ? transaction.reference : undefined,
      notes: typeof transaction.notes === "string" ? transaction.notes : undefined,
      attachmentName: typeof transaction.attachmentName === "string" ? transaction.attachmentName : undefined,
      importBatchId: typeof transaction.importBatchId === "string" ? transaction.importBatchId : undefined,
      source: transaction.source as WorkspaceState["transactions"][number]["source"],
      billId: typeof transaction.billId === "string" ? transaction.billId : undefined,
      reversesTransactionId: typeof transaction.reverses === "string" ? transaction.reverses : undefined,
      reversedByTransactionId: typeof transaction.reversedBy === "string" ? transaction.reversedBy : undefined,
      reversalReason: typeof transaction.reversalReason === "string" ? transaction.reversalReason : undefined,
      createdBy: String(transaction.createdBy || user.name || ""), createdAt: String(transaction.createdAt || ""),
    })),
    invoices: invoices.map((invoice) => ({
      id: String(invoice.id), organisationId: option.id, invoiceNumber: String(invoice.invoiceNumber), customerId: String(invoice.customerId),
      issueDate: asDate(invoice.issueDate), dueDate: asDate(invoice.dueDate), status: invoice.status as WorkspaceState["invoices"][number]["status"],
      lines: (Array.isArray(invoice.lines) ? invoice.lines as Record<string, unknown>[] : []).map((line) => ({
        id: String(line.id), description: String(line.description), quantity: Number(line.quantity), unitPriceKobo: asMoney(line.unitPriceKobo),
      })),
      discountKobo: asMoney(invoice.discountKobo), taxLabel: typeof invoice.taxLabel === "string" ? invoice.taxLabel : undefined,
      taxRatePercent: Number(invoice.taxRatePercent || 0), terms: String(invoice.terms || ""), paymentInstructions: String(invoice.paymentInstructions || ""),
      notes: typeof invoice.notes === "string" ? invoice.notes : undefined,
      lastReminderSentAt: typeof invoice.lastReminderSentAt === "string" ? asDate(invoice.lastReminderSentAt) : undefined,
      receipts: (Array.isArray(invoice.receipts) ? invoice.receipts as Record<string, unknown>[] : []).map((receipt) => ({
        id: String(receipt.id), invoiceId: String(invoice.id), date: asDate(receipt.date), amountKobo: asMoney(receipt.amountKobo),
        methodLabel: String(receipt.methodLabel || "Recorded receipt"), reference: String(receipt.reference || ""),
        trackingAccountId: String(receipt.trackingAccountId), recordedBy: String(receipt.recordedBy || ""), recordedAt: String(receipt.recordedAt || ""), transactionId: String(receipt.transactionId),
      })),
      createdBy: String(invoice.createdBy || user.name || ""), createdAt: String(invoice.createdAt || ""),
    })),
    bills: bills.map((bill) => ({
      id: String(bill.id), organisationId: option.id, billNumber: String(bill.billNumber), supplierId: String(bill.supplierId),
      billDate: asDate(bill.billDate), dueDate: asDate(bill.dueDate), amountKobo: asMoney(bill.amountKobo), paidAmountKobo: asMoney(bill.paidAmountKobo),
      categoryId: String(bill.categoryId), reference: typeof bill.reference === "string" ? bill.reference : undefined,
      status: bill.status as WorkspaceState["bills"][number]["status"], notes: typeof bill.notes === "string" ? bill.notes : undefined,
      attachmentName: typeof bill.attachmentName === "string" ? bill.attachmentName : undefined,
      createdBy: String(bill.createdBy || user.name || ""), createdAt: String(bill.createdAt || ""),
    })),
    importBatches: imports.map((batch) => {
      const batchRows = Array.isArray(batch.rows) ? (batch.rows as Record<string, unknown>[]) : [];
      const trackingAccountId = String(batch.trackingAccountId);
      return {
        id: String(batch.id),
        organisationId: option.id,
        fileName: String(batch.fileName || "statement.csv"),
        trackingAccountId,
        uploadedBy: String(batch.uploadedBy || user.name || "Member"),
        uploadedAt: String(batch.uploadedAt || ""),
        committedAt: typeof batch.committedAt === "string" ? batch.committedAt : undefined,
        totalRows: Number(batch.totalRows || batchRows.length),
        committedCount: Number(batch.committedCount || 0),
        skippedCount: Number(batch.skippedCount || 0),
        errorCount: Number(batch.errorCount || 0),
        status: batch.status === "committed" ? "committed" : "preview",
        rows: batchRows.map((r) => {
          const rawData = (r.rawData && typeof r.rawData === "object" ? r.rawData : {}) as Record<string, unknown>;
          const outcome = String(r.outcome || "preview");
          return {
            rowNumber: Number(r.rowNumber || 1),
            serverRowId: String(r.id),
            rawDate: String(rawData.date || ""),
            parsedDate: typeof rawData.date === "string" ? rawData.date : undefined,
            rawDescription: String(rawData.description || "Unparsed row"),
            rawAmount: String(rawData.amountKobo || "0"),
            amountKobo: typeof rawData.amountKobo === "string" ? Number(rawData.amountKobo) : undefined,
            direction: rawData.direction === "inflow" || rawData.direction === "outflow" ? rawData.direction : undefined,
            reference: typeof rawData.reference === "string" ? rawData.reference : undefined,
            categoryId: defaultCategoryId,
            trackingAccountId,
            status: outcome === "error" ? "error" : outcome === "duplicate" ? "duplicate_candidate" : "valid",
            issueMessage: typeof r.issue === "string" ? r.issue : undefined,
            decision: outcome === "skipped" || outcome === "error" || outcome === "duplicate" ? "skip" : "include",
          };
        }),
      };
    }),
    auditEvents: auditEvents.map((event) => {
      const rawEntity = String(event.entityType || "workspace");
      const normalizedEntity = (rawEntity === "import_batch" ? "import" : rawEntity === "organisation" ? "workspace" : rawEntity) as WorkspaceState["auditEvents"][number]["entityType"];
      return {
        id: String(event.id),
        organisationId: option.id,
        actorName: typeof event.actorName === "string" && event.actorName.trim()
          ? event.actorName
          : event.actorUserId === user.id
            ? user.name || user.email || "You"
            : String(event.actorUserId || "System"),
        actorRole: (event.actorRole || option.role || "accountant") as Role,
        action: String(event.action),
        entityType: normalizedEntity,
        entityId: String(event.entityId),
        summary: event.reason ? `${String(event.action).replaceAll("_", " ").replaceAll(".", " ")} — ${String(event.reason)}` : String(event.action).replaceAll("_", " ").replaceAll(".", " "),
        beforeSnapshot: event.before ? JSON.stringify(event.before) : undefined,
        afterSnapshot: event.after ? JSON.stringify(event.after) : undefined,
        timestamp: String(event.createdAt || ""),
      };
    }),
    dismissedObservationIds: Array.isArray(option.dismissedObservations) ? option.dismissedObservations : [],
    reviewedObservationIds: reviewedMap,
    sessions: sessions.length > 0
      ? sessions.map((s) => ({
          id: String(s.id),
          device: String(s.device || "Web Browser"),
          location: String(s.location || "Nigeria (WAT)"),
          lastActive: typeof s.lastActive === "string" ? s.lastActive.slice(0, 16).replace("T", " ") : "Active now",
          current: Boolean(s.current),
        }))
      : [
          {
            id: "current-session",
            device: "Current Authenticated Browser Session",
            location: "Nigeria (WAT)",
            lastActive: "Active now",
            current: true,
          },
        ],
    notificationPreferences: {
      emailInvoiceOverdue: Boolean(option.notificationPrefs?.emailInvoiceOverdue ?? true),
      emailSupplierDueSoon: Boolean(option.notificationPrefs?.emailSupplierDueSoon ?? true),
      emailImportSummary: Boolean(option.notificationPrefs?.emailImportSummary ?? false),
      inAppLowCashAlert: Boolean(option.notificationPrefs?.inAppLowCashAlert ?? true),
      frequency: option.notificationPrefs?.frequency ?? "weekly_brief",
      hideAmountsInSubject: Boolean(option.notificationPrefs?.hideAmountsInSubject ?? true),
    },
  };
}
