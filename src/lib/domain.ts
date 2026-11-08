import { formatNgn, parseSignedCsvAmountToKobo } from "./money";
import { Membership, Role } from "./tenant";

export type TransactionType = "income" | "expense" | "transfer" | "refund" | "adjustment";
export type TransactionStatus = "draft" | "posted" | "reversed";
export type TransactionSource = "manual" | "csv_import" | "invoice_receipt" | "bill_payment" | "reversal";

export interface BusinessWorkspace {
  id: string;
  legalName: string;
  displayName: string;
  businessType: "Service & Creative" | "Retail & Trade" | "Distribution" | "Light Manufacturing" | "Professional Services";
  stateCity: string;
  timezone: "Africa/Lagos";
  baseCurrency: "NGN";
  financialYearStartMonth: number; // 1 = January
  taxId?: string;
  lowCashThresholdKobo: number;
  planName: string;
  onboardingCompletedSteps: string[];
  updatedAt: string;
}

export interface TrackingAccount {
  id: string;
  organisationId: string;
  name: string;
  kind: "bank_label" | "pos_label" | "cash_label";
  maskedRef?: string;
  openingBalanceKobo: number;
  openingBalanceDate: string;
  archived: boolean;
}

export interface Category {
  id: string;
  organisationId: string;
  name: string;
  type: "income" | "expense" | "both";
  archived: boolean;
}

export interface Contact {
  id: string;
  organisationId: string;
  name: string;
  roles: ("customer" | "supplier")[];
  email?: string;
  phone?: string;
  businessId?: string;
  notes?: string;
  status: "active" | "archived";
  createdAt: string;
}

export interface TransactionRecord {
  id: string;
  organisationId: string;
  date: string; // YYYY-MM-DD
  description: string;
  type: TransactionType;
  status: TransactionStatus;
  /** Always positive integer kobo; direction is determined by `direction` */
  amountKobo: number;
  direction: "inflow" | "outflow";
  categoryId: string;
  trackingAccountId: string;
  transferToAccountId?: string;
  contactId?: string;
  reference?: string;
  notes?: string;
  attachmentName?: string;
  source: TransactionSource;
  importBatchId?: string;
  invoiceId?: string;
  billId?: string;
  reversedByTransactionId?: string;
  reversesTransactionId?: string;
  reversalReason?: string;
  createdBy: string;
  createdAt: string;
  idempotencyKey?: string;
}

export interface InvoiceLine {
  id: string;
  description: string;
  quantity: number;
  unitPriceKobo: number;
}

export interface InvoiceReceipt {
  id: string;
  invoiceId: string;
  date: string;
  amountKobo: number;
  methodLabel: string;
  reference: string;
  trackingAccountId: string;
  recordedBy: string;
  recordedAt: string;
  transactionId: string;
}

export type InvoiceLifecycleState = "draft" | "shared" | "partially_paid" | "paid" | "disputed" | "cancelled";

export interface Invoice {
  id: string;
  organisationId: string;
  invoiceNumber: string;
  customerId: string;
  issueDate: string; // YYYY-MM-DD
  dueDate: string; // YYYY-MM-DD
  status: InvoiceLifecycleState;
  lines: InvoiceLine[];
  discountKobo: number;
  taxLabel?: string; // e.g. "VAT (User-configured 7.5%)"
  taxRatePercent?: number;
  terms: string;
  paymentInstructions: string;
  notes?: string;
  receipts: InvoiceReceipt[];
  lastReminderSentAt?: string;
  createdBy: string;
  createdAt: string;
}

export type BillStatus = "open" | "partially_paid" | "paid" | "cancelled";

export interface SupplierBill {
  id: string;
  organisationId: string;
  billNumber: string;
  supplierId: string;
  billDate: string;
  dueDate: string;
  amountKobo: number;
  paidAmountKobo: number;
  categoryId: string;
  reference?: string;
  status: BillStatus;
  notes?: string;
  attachmentName?: string;
  createdBy: string;
  createdAt: string;
}

export interface ImportRowPreview {
  rowNumber: number;
  rawDate: string;
  parsedDate?: string;
  rawDescription: string;
  rawAmount: string;
  amountKobo?: number;
  direction?: "inflow" | "outflow";
  reference?: string;
  categoryId: string;
  trackingAccountId: string;
  status: "valid" | "duplicate_candidate" | "error";
  issueMessage?: string;
  duplicateOfTransactionId?: string;
  decision: "include" | "skip";
}

export interface ImportBatch {
  id: string;
  organisationId: string;
  fileName: string;
  trackingAccountId: string;
  uploadedBy: string;
  uploadedAt: string;
  committedAt?: string;
  totalRows: number;
  committedCount: number;
  skippedCount: number;
  errorCount: number;
  status: "preview" | "committed";
  rows: ImportRowPreview[];
}

export interface AuditEvent {
  id: string;
  organisationId: string;
  actorName: string;
  actorRole: Role;
  action: string;
  entityType: "transaction" | "invoice" | "bill" | "import" | "member" | "workspace" | "category" | "contact";
  entityId: string;
  summary: string;
  beforeSnapshot?: string;
  afterSnapshot?: string;
  timestamp: string;
}

export interface ActiveSession {
  id: string;
  device: string;
  location: string;
  lastActive: string;
  current: boolean;
}

export interface NotificationPreferences {
  emailInvoiceOverdue: boolean;
  emailSupplierDueSoon: boolean;
  emailImportSummary: boolean;
  inAppLowCashAlert: boolean;
  frequency: "immediate" | "daily_digest" | "weekly_brief";
  hideAmountsInSubject: boolean;
}

export interface MoneyBriefObservation {
  id: string;
  rank: number;
  tone: "amber" | "blue" | "green" | "coral";
  mark: string;
  title: string;
  whyItAppears: string;
  calculationSummary: string;
  periodWindow: string;
  amountKobo: number;
  supportingRecordIds: string[];
  supportingEntityKind: "invoice" | "bill" | "transaction";
  limitationNote: string;
  actionLabel: string;
  targetTab: "invoices" | "suppliers" | "transactions" | "cashflow";
  dismissed?: boolean;
  reviewedAt?: string;
}

export interface WorkspaceState {
  workspace: BusinessWorkspace;
  members: Membership[];
  trackingAccounts: TrackingAccount[];
  categories: Category[];
  contacts: Contact[];
  transactions: TransactionRecord[];
  invoices: Invoice[];
  bills: SupplierBill[];
  importBatches: ImportBatch[];
  auditEvents: AuditEvent[];
  dismissedObservationIds: string[];
  reviewedObservationIds: Record<string, string>;
  sessions: ActiveSession[];
  notificationPreferences: NotificationPreferences;
}

/** Reference "current" date in the Ledgerly MVP environment (6 Nov 2026, Africa/Lagos) */
export const CURRENT_REFERENCE_DATE = "2026-11-06";

export function formatDisplayDate(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(d).padStart(2, "0")} ${months[m - 1]} ${y}`;
}

export function daysBetween(startIso: string, endIso: string): number {
  const d1 = new Date(`${startIso.slice(0, 10)}T00:00:00Z`).getTime();
  const d2 = new Date(`${endIso.slice(0, 10)}T00:00:00Z`).getTime();
  return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
}

export function computeInvoiceTotals(invoice: Invoice): {
  subtotalKobo: number;
  discountKobo: number;
  taxableKobo: number;
  taxKobo: number;
  totalKobo: number;
  paidKobo: number;
  outstandingKobo: number;
  isOverdue: boolean;
  daysOverdue: number;
  effectiveState: InvoiceLifecycleState | "overdue";
} {
  const subtotalKobo = invoice.lines.reduce(
    (sum, line) => sum + Math.round(line.quantity * line.unitPriceKobo),
    0,
  );
  const discountKobo = Math.min(invoice.discountKobo, subtotalKobo);
  const taxableKobo = Math.max(0, subtotalKobo - discountKobo);
  const taxKobo = invoice.taxRatePercent
    ? Math.round((taxableKobo * invoice.taxRatePercent) / 100)
    : 0;
  const totalKobo = taxableKobo + taxKobo;
  const paidKobo = invoice.receipts.reduce((sum, r) => sum + r.amountKobo, 0);
  const outstandingKobo = Math.max(0, totalKobo - paidKobo);

  const overdueDays = daysBetween(invoice.dueDate, CURRENT_REFERENCE_DATE);
  const isOverdue =
    outstandingKobo > 0 &&
    invoice.status !== "draft" &&
    invoice.status !== "cancelled" &&
    overdueDays > 0;

  let effectiveState: InvoiceLifecycleState | "overdue" = invoice.status;
  if (invoice.status !== "cancelled" && invoice.status !== "draft") {
    if (outstandingKobo === 0 && totalKobo > 0) {
      effectiveState = "paid";
    } else if (isOverdue) {
      effectiveState = "overdue";
    } else if (paidKobo > 0 && outstandingKobo > 0) {
      effectiveState = "partially_paid";
    }
  }

  return {
    subtotalKobo,
    discountKobo,
    taxableKobo,
    taxKobo,
    totalKobo,
    paidKobo,
    outstandingKobo,
    isOverdue,
    daysOverdue: isOverdue ? overdueDays : 0,
    effectiveState,
  };
}

export function computeBillStatus(bill: SupplierBill): {
  outstandingKobo: number;
  daysUntilDue: number;
  isOverdue: boolean;
  isDueSoon: boolean;
  effectiveStatus: "paid" | "overdue" | "due_this_week" | "upcoming" | "cancelled";
} {
  if (bill.status === "cancelled") {
    return {
      outstandingKobo: 0,
      daysUntilDue: 0,
      isOverdue: false,
      isDueSoon: false,
      effectiveStatus: "cancelled",
    };
  }
  const outstandingKobo = Math.max(0, bill.amountKobo - bill.paidAmountKobo);
  if (outstandingKobo === 0 || bill.status === "paid") {
    return {
      outstandingKobo: 0,
      daysUntilDue: 0,
      isOverdue: false,
      isDueSoon: false,
      effectiveStatus: "paid",
    };
  }
  const daysUntilDue = daysBetween(CURRENT_REFERENCE_DATE, bill.dueDate);
  const isOverdue = daysUntilDue < 0;
  const isDueSoon = daysUntilDue >= 0 && daysUntilDue <= 7;
  return {
    outstandingKobo,
    daysUntilDue,
    isOverdue,
    isDueSoon,
    effectiveStatus: isOverdue ? "overdue" : isDueSoon ? "due_this_week" : "upcoming",
  };
}

export function computeTrackingAccountBalances(state: WorkspaceState): Array<{
  account: TrackingAccount;
  inflowKobo: number;
  outflowKobo: number;
  recordedBalanceKobo: number;
  transactionCount: number;
}> {
  const posted = state.transactions.filter((t) => t.status === "posted");
  return state.trackingAccounts
    .filter((a) => !a.archived)
    .map((account) => {
      let inflowKobo = 0;
      let outflowKobo = 0;
      let transactionCount = 0;

      for (const tx of posted) {
        if (tx.trackingAccountId === account.id) {
          transactionCount += 1;
          if (tx.direction === "inflow") {
            inflowKobo += tx.amountKobo;
          } else {
            outflowKobo += tx.amountKobo;
          }
        }
        if (tx.type === "transfer" && tx.transferToAccountId === account.id) {
          transactionCount += 1;
          inflowKobo += tx.amountKobo;
        }
      }

      return {
        account,
        inflowKobo,
        outflowKobo,
        recordedBalanceKobo: account.openingBalanceKobo + inflowKobo - outflowKobo,
        transactionCount,
      };
    });
}

export function computeDashboardSummary(state: WorkspaceState, periodDays = 30) {
  const accountBalances = computeTrackingAccountBalances(state);
  const recordedCashKobo = accountBalances.reduce((sum, item) => sum + item.recordedBalanceKobo, 0);

  const posted = state.transactions.filter((t) => t.status === "posted");
  const windowPosted = posted.filter((t) => {
    const age = daysBetween(t.date, CURRENT_REFERENCE_DATE);
    return age >= 0 && age <= periodDays;
  });

  const previousWindowPosted = posted.filter((t) => {
    const age = daysBetween(t.date, CURRENT_REFERENCE_DATE);
    return age > periodDays && age <= periodDays * 2;
  });

  const incomeKobo = windowPosted
    .filter((t) => t.direction === "inflow" && t.type !== "transfer")
    .reduce((sum, t) => sum + t.amountKobo, 0);

  const expenseKobo = windowPosted
    .filter((t) => t.direction === "outflow" && t.type !== "transfer")
    .reduce((sum, t) => sum + t.amountKobo, 0);

  const prevIncomeKobo = previousWindowPosted
    .filter((t) => t.direction === "inflow" && t.type !== "transfer")
    .reduce((sum, t) => sum + t.amountKobo, 0);

  const prevExpenseKobo = previousWindowPosted
    .filter((t) => t.direction === "outflow" && t.type !== "transfer")
    .reduce((sum, t) => sum + t.amountKobo, 0);

  const netMovementKobo = incomeKobo - expenseKobo;
  const prevNetMovementKobo = prevIncomeKobo - prevExpenseKobo;

  const evaluatedInvoices = state.invoices.map((inv) => ({
    invoice: inv,
    calc: computeInvoiceTotals(inv),
  }));

  const openInvoices = evaluatedInvoices.filter(
    (x) => x.calc.outstandingKobo > 0 && x.invoice.status !== "draft" && x.invoice.status !== "cancelled",
  );
  const overdueInvoices = openInvoices.filter((x) => x.calc.isOverdue);
  const toCollectKobo = openInvoices.reduce((sum, x) => sum + x.calc.outstandingKobo, 0);
  const overdueReceivablesKobo = overdueInvoices.reduce((sum, x) => sum + x.calc.outstandingKobo, 0);

  const evaluatedBills = state.bills.map((b) => ({
    bill: b,
    calc: computeBillStatus(b),
  }));
  const unpaidBills = evaluatedBills.filter((x) => x.calc.outstandingKobo > 0);
  const dueSoonOrOverdueBills = unpaidBills.filter(
    (x) => x.calc.isOverdue || x.calc.isDueSoon,
  );
  const billsDueSoonKobo = dueSoonOrOverdueBills.reduce(
    (sum, x) => sum + x.calc.outstandingKobo,
    0,
  );

  const latestRecordDate = posted.reduce(
    (max, t) => (t.date > max ? t.date : max),
    "2026-10-01",
  );

  const categorizedCount = posted.filter((t) => Boolean(t.categoryId && t.trackingAccountId)).length;
  const completenessPercent =
    posted.length === 0 ? 100 : Math.round((categorizedCount / posted.length) * 100);

  return {
    recordedCashKobo,
    incomeKobo,
    expenseKobo,
    netMovementKobo,
    prevNetMovementKobo,
    toCollectKobo,
    openInvoiceCount: openInvoices.length,
    overdueInvoices,
    overdueReceivablesKobo,
    unpaidBills,
    dueSoonOrOverdueBills,
    billsDueSoonKobo,
    latestRecordDate,
    completenessPercent,
    windowPostedCount: windowPosted.length,
  };
}

/**
 * Deterministic Money Brief Engine (PRD Section 3 & UI/UX Section 9.3).
 * Generates evidence-linked rule observations without opaque AI or hidden predictions.
 */
export function buildMoneyBrief(state: WorkspaceState, periodDays = 30): MoneyBriefObservation[] {
  const summary = computeDashboardSummary(state, periodDays);
  const contactsById = new Map(state.contacts.map((c) => [c.id, c.name]));
  const observations: MoneyBriefObservation[] = [];

  // Rule 1: Overdue Invoices
  if (summary.overdueInvoices.length > 0) {
    const first = summary.overdueInvoices[0];
    const customerName = contactsById.get(first.invoice.customerId) ?? "Customer";
    const count = summary.overdueInvoices.length;
    observations.push({
      id: "obs-overdue-invoices",
      rank: 1,
      tone: "amber",
      mark: "↗",
      title: count === 1 ? "One invoice needs a follow-up" : `${count} invoices are past their due date`,
      whyItAppears:
        count === 1
          ? `${customerName} (${first.invoice.invoiceNumber}) is ${first.calc.daysOverdue} days overdue · Based on 1 open invoice`
          : `Includes ${customerName} (${first.calc.daysOverdue} days overdue) and ${count - 1} other open invoice(s)`,
      calculationSummary: `Sum of unpaid balances on ${count} issued invoice(s) with due dates before ${formatDisplayDate(CURRENT_REFERENCE_DATE)}.`,
      periodWindow: `As of ${formatDisplayDate(CURRENT_REFERENCE_DATE)}`,
      amountKobo: summary.overdueReceivablesKobo,
      supportingRecordIds: summary.overdueInvoices.map((x) => x.invoice.id),
      supportingEntityKind: "invoice",
      limitationNote: "Reflects user-recorded receipts only. Confirm bank alerts before sending a reminder.",
      actionLabel: "Review & send reminder",
      targetTab: "invoices",
      dismissed: state.dismissedObservationIds.includes("obs-overdue-invoices"),
      reviewedAt: state.reviewedObservationIds["obs-overdue-invoices"],
    });
  }

  // Rule 2: Supplier obligations due soon or overdue
  if (summary.dueSoonOrOverdueBills.length > 0) {
    const first = summary.dueSoonOrOverdueBills[0];
    const supplierName = contactsById.get(first.bill.supplierId) ?? "Supplier";
    const count = summary.dueSoonOrOverdueBills.length;
    const dueLabel =
      first.calc.daysUntilDue < 0
        ? `${Math.abs(first.calc.daysUntilDue)} days overdue`
        : first.calc.daysUntilDue === 0
          ? "Due today"
          : `Due in ${first.calc.daysUntilDue} day(s) (${formatDisplayDate(first.bill.dueDate)})`;

    observations.push({
      id: "obs-supplier-bills-due",
      rank: 2,
      tone: "blue",
      mark: "•",
      title: count === 1 ? "Supplier bill due this week" : `${count} supplier bills need attention`,
      whyItAppears: `${supplierName} · ${dueLabel} · Based on ${count} recorded obligation(s)`,
      calculationSummary: `Total outstanding amount on supplier bills due within 7 days or past due as of ${formatDisplayDate(CURRENT_REFERENCE_DATE)}.`,
      periodWindow: "Next 7 days",
      amountKobo: summary.billsDueSoonKobo,
      supportingRecordIds: summary.dueSoonOrOverdueBills.map((x) => x.bill.id),
      supportingEntityKind: "bill",
      limitationNote: "Bookkeeping obligation only. Ledgerly does not initiate bank transfers.",
      actionLabel: "Inspect supplier bills",
      targetTab: "suppliers",
      dismissed: state.dismissedObservationIds.includes("obs-supplier-bills-due"),
      reviewedAt: state.reviewedObservationIds["obs-supplier-bills-due"],
    });
  }

  // Rule 3: Low recorded cash threshold OR positive cash movement
  if (summary.recordedCashKobo < state.workspace.lowCashThresholdKobo) {
    observations.push({
      id: "obs-low-recorded-cash",
      rank: 3,
      tone: "coral",
      mark: "!",
      title: "Recorded cash is below your alert threshold",
      whyItAppears: `Below your ${formatNgn(state.workspace.lowCashThresholdKobo)} workspace threshold across active tracking labels`,
      calculationSummary: "Opening balances plus posted inflows minus posted outflows across all active tracking labels.",
      periodWindow: `Through ${formatDisplayDate(summary.latestRecordDate)}`,
      amountKobo: summary.recordedCashKobo,
      supportingRecordIds: state.transactions.filter((t) => t.status === "posted").map((t) => t.id),
      supportingEntityKind: "transaction",
      limitationNote: "Calculated from recorded entries; excludes unimported POS or bank statements.",
      actionLabel: "View cash flow breakdown",
      targetTab: "cashflow",
      dismissed: state.dismissedObservationIds.includes("obs-low-recorded-cash"),
      reviewedAt: state.reviewedObservationIds["obs-low-recorded-cash"],
    });
  } else {
    const windowTx = state.transactions.filter(
      (t) =>
        t.status === "posted" &&
        t.type !== "transfer" &&
        daysBetween(t.date, CURRENT_REFERENCE_DATE) >= 0 &&
        daysBetween(t.date, CURRENT_REFERENCE_DATE) <= periodDays,
    );
    const isPositive = summary.netMovementKobo >= 0;
    observations.push({
      id: "obs-cash-movement",
      rank: 3,
      tone: isPositive ? "green" : "coral",
      mark: isPositive ? "✓" : "↘",
      title: isPositive ? "Your recorded cash increased" : "Recorded outflows exceeded inflows",
      whyItAppears: `Net movement over the last ${periodDays} days · ${windowTx.length} posted entries`,
      calculationSummary: `Recorded income (${formatNgn(summary.incomeKobo)}) minus recorded expenses (${formatNgn(summary.expenseKobo)}) in the selected ${periodDays}-day window.`,
      periodWindow: `Last ${periodDays} days`,
      amountKobo: Math.abs(summary.netMovementKobo),
      supportingRecordIds: windowTx.map((t) => t.id),
      supportingEntityKind: "transaction",
      limitationNote: "These observations use records entered or imported into Ledgerly, not live bank feeds.",
      actionLabel: "Explore contributing entries",
      targetTab: "transactions",
      dismissed: state.dismissedObservationIds.includes("obs-cash-movement"),
      reviewedAt: state.reviewedObservationIds["obs-cash-movement"],
    });
  }

  return observations;
}

/**
 * Parses CSV text and evaluates rows against existing transactions for duplicates & malformed data.
 */
export function parseAndValidateCsvImport(params: {
  csvText: string;
  dateFormat: "YYYY-MM-DD" | "DD/MM/YYYY";
  decimalSeparator: "." | ",";
  defaultCategoryId: string;
  trackingAccountId: string;
  existingTransactions: TransactionRecord[];
}): ImportRowPreview[] {
  const lines = params.csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length <= 1) return [];

  // Skip header row
  const dataLines = lines.slice(1);

  return dataLines.map((line, idx) => {
    const rowNumber = idx + 2;
    const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const [rawDate = "", rawDescription = "", rawAmount = "", rawReference = "", rawType = ""] = cols;

    if (!rawDate || !rawDescription || !rawAmount) {
      return {
        rowNumber,
        rawDate,
        rawDescription: rawDescription || "(Missing description)",
        rawAmount,
        reference: rawReference,
        categoryId: params.defaultCategoryId,
        trackingAccountId: params.trackingAccountId,
        status: "error",
        issueMessage: "Missing required column(s): Date, Description, and Amount are required.",
        decision: "skip",
      };
    }

    // Parse date
    let parsedDate: string | undefined;
    if (params.dateFormat === "YYYY-MM-DD" && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
      parsedDate = rawDate;
    } else if (params.dateFormat === "DD/MM/YYYY" && /^\d{2}\/\d{2}\/\d{4}$/.test(rawDate)) {
      const [dd, mm, yyyy] = rawDate.split("/");
      parsedDate = `${yyyy}-${mm}-${dd}`;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
      parsedDate = rawDate;
    }

    if (!parsedDate || Number.isNaN(new Date(`${parsedDate}T00:00:00Z`).getTime())) {
      return {
        rowNumber,
        rawDate,
        rawDescription,
        rawAmount,
        reference: rawReference,
        categoryId: params.defaultCategoryId,
        trackingAccountId: params.trackingAccountId,
        status: "error",
        issueMessage: `Invalid date "${rawDate}". Expected ${params.dateFormat}.`,
        decision: "skip",
      };
    }

    // Parse amount
    let amountKobo = 0;
    let direction: "inflow" | "outflow" = "inflow";
    try {
      const parsed = parseSignedCsvAmountToKobo(rawAmount, params.decimalSeparator);
      amountKobo = parsed.amountKobo;
      if (rawType.toLowerCase() === "expense" || rawType.toLowerCase() === "debit" || parsed.isNegative) {
        direction = "outflow";
      } else {
        direction = "inflow";
      }
    } catch (err) {
      return {
        rowNumber,
        rawDate,
        parsedDate,
        rawDescription,
        rawAmount,
        reference: rawReference,
        categoryId: params.defaultCategoryId,
        trackingAccountId: params.trackingAccountId,
        status: "error",
        issueMessage: err instanceof Error ? err.message : "Malformed amount value",
        decision: "skip",
      };
    }

    // Check duplicates by date + amount + normalized description or reference
    const duplicateMatch = params.existingTransactions.find(
      (tx) =>
        tx.status === "posted" &&
        tx.date === parsedDate &&
        tx.amountKobo === amountKobo &&
        tx.direction === direction &&
        ((rawReference && tx.reference && tx.reference.toLowerCase() === rawReference.toLowerCase()) ||
          tx.description.toLowerCase() === rawDescription.toLowerCase()),
    );

    if (duplicateMatch) {
      return {
        rowNumber,
        rawDate,
        parsedDate,
        rawDescription,
        rawAmount,
        amountKobo,
        direction,
        reference: rawReference,
        categoryId: params.defaultCategoryId,
        trackingAccountId: params.trackingAccountId,
        status: "duplicate_candidate",
        duplicateOfTransactionId: duplicateMatch.id,
        issueMessage: `Likely duplicate of existing entry "${duplicateMatch.description}" (${formatDisplayDate(duplicateMatch.date)})`,
        decision: "skip",
      };
    }

    return {
      rowNumber,
      rawDate,
      parsedDate,
      rawDescription,
      rawAmount,
      amountKobo,
      direction,
      reference: rawReference,
      categoryId: params.defaultCategoryId,
      trackingAccountId: params.trackingAccountId,
      status: "valid",
      decision: "include",
    };
  });
}

