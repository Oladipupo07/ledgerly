"use client";

import React, { useState, useCallback, useEffect } from "react";
import {
  WorkspaceState,
  formatDisplayDate,
  computeInvoiceTotals,
  computeBillStatus,
} from "@/lib/domain";
import { createInitialWorkspaceState } from "@/lib/seed";
import { hasCapability, ROLE_DESCRIPTIONS } from "@/lib/tenant";
import { formatNgn } from "@/lib/money";
import { OverviewView, NavTab } from "@/components/OverviewView";
import { TransactionsView } from "@/components/TransactionsView";
import { InvoicesView } from "@/components/InvoicesView";
import { ContactsAndBillsView } from "@/components/ContactsAndBillsView";
import { CashFlowAndReportsView } from "@/components/CashFlowAndReportsView";
import { TeamAuditSettingsView } from "@/components/TeamAuditSettingsView";
import { apiRequest, ClientApiError, loadWorkspaceData, newIdempotencyKey, type WorkspaceOption } from "@/lib/client-api";
import { signOut } from "next-auth/react";

type SignedInUser = { id: string; name?: string | null; email?: string | null };
type AuthSession = { user?: SignedInUser } | null;
async function loadSession(): Promise<AuthSession> {
  const response = await fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new Error("Could not verify the current sign-in session.");
  return response.json() as Promise<AuthSession>;
}

export default function LedgerlyApp() {
  const [state, setState] = useState<WorkspaceState>(() => createInitialWorkspaceState());
  const [bootstrapStatus, setBootstrapStatus] = useState<"loading" | "signed-out" | "needs-workspace" | "ready" | "error">("loading");
  const [bootstrapError, setBootstrapError] = useState("");
  const [currentUser, setCurrentUser] = useState<SignedInUser | null>(null);
  const [workspaceOptions, setWorkspaceOptions] = useState<WorkspaceOption[]>([]);
  const [setupForm, setSetupForm] = useState({ legalName: "", displayName: "", businessType: "Professional Services", stateCity: "" });
  const [setupBusy, setSetupBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<NavTab>("overview");
  const [showMobileMore, setShowMobileMore] = useState(false);
  const [txTypeFilterHint, setTxTypeFilterHint] = useState<string>("all");
  const [txModalSignal, setTxModalSignal] = useState<"new_tx" | "csv_import" | null>(null);

  const [activeMemberId, setActiveMemberId] = useState<string>("mem-1");
  const activeMember =
    state.members.find((m) => m.id === activeMemberId && m.status === "active") ??
    state.members[0];
  const overdueInvoices = state.invoices.filter((invoice) => computeInvoiceTotals(invoice).isOverdue);
  const dueBills = state.bills.filter((bill) => {
    const status = computeBillStatus(bill);
    return status.isOverdue || status.isDueSoon;
  });
  const setupProgress = [Boolean(currentUser?.id), Boolean(state.workspace.legalName), state.workspace.baseCurrency === "NGN", state.trackingAccounts.length > 0, state.transactions.length > 0 || state.members.length > 1].filter(Boolean).length;

  const mobileMoreItems: { id: NavTab; label: string; icon: string; capability?: Parameters<typeof hasCapability>[1] }[] = [
    { id: "customers", label: "Customers", icon: "♙" },
    { id: "suppliers", label: "Suppliers", icon: "◇" },
    { id: "cashflow", label: "Cash flow", icon: "⌁", capability: "report:view" },
    { id: "reports", label: "Reports", icon: "▥", capability: "report:view" },
    { id: "team", label: "Team & audit", icon: "⊕", capability: "audit:view_own" },
    { id: "settings", label: "Settings", icon: "⚙", capability: "workspace:manage_settings" },
  ];

  // Global Header Modals
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [globalSearchQuery, setGlobalSearchQuery] = useState("");
  const [toastBanner, setToastBanner] = useState<string | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [invitationLink, setInvitationLink] = useState("");

  const loadDataForWorkspace = useCallback(async (workspaceId?: string) => {
    const session = await loadSession();
    if (!session?.user?.id) {
      setCurrentUser(null);
      setBootstrapStatus("signed-out");
      return;
    }
    setCurrentUser(session.user);
    const options = await apiRequest<WorkspaceOption[]>("/api/v1/workspace");
    setWorkspaceOptions(options);
    if (!options.length) {
      setBootstrapStatus("needs-workspace");
      return;
    }
    const savedId = typeof window !== "undefined" ? window.localStorage.getItem("ledgerly.activeWorkspace") : null;
    const selected = options.find((option) => option.id === (workspaceId || savedId)) ?? options[0];
    const loaded = await loadWorkspaceData(selected, { id: session.user.id, name: session.user.name || "", email: session.user.email });
    setState(loaded);
    setActiveMemberId(session.user.id);
    if (typeof window !== "undefined") window.localStorage.setItem("ledgerly.activeWorkspace", selected.id);
    setBootstrapStatus("ready");
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadDataForWorkspace().catch((error: unknown) => {
      if (cancelled) return;
      setBootstrapError(error instanceof Error ? error.message : "Ledgerly could not load workspace data.");
      setBootstrapStatus("error");
    });
    return () => { cancelled = true; };
  }, [loadDataForWorkspace]);

  const refreshWorkspace = useCallback(async (workspaceId?: string) => {
    try {
      await loadDataForWorkspace(workspaceId ?? state.workspace.id);
      setToastBanner("Workspace data refreshed.");
    } catch (error) {
      setToastBanner(error instanceof Error ? error.message : "Could not refresh workspace data.");
    }
  }, [loadDataForWorkspace, state.workspace.id]);

  const createWorkspace = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (setupBusy) return;
    setSetupBusy(true);
    setBootstrapError("");
    try {
      const created = await apiRequest<{ id: string }>("/api/v1/workspace", {
        method: "POST", body: JSON.stringify({ ...setupForm, fiscalYearStartMonth: 1 }),
      });
      const categories = [
        ["Sales", "income"], ["Other income", "income"], ["Operating expenses", "expense"],
        ["Supplier costs", "expense"], ["General", "both"],
      ] as const;
      for (const [name, type] of categories) {
        try {
          await apiRequest(`/api/v1/organisations/${created.id}/categories`, {
            method: "POST", body: JSON.stringify({ name, type }),
          }, `setup:${created.id}:category:${name.toLowerCase().replaceAll(" ", "-")}`);
        } catch (error) { if (!(error instanceof ClientApiError && error.status === 409)) throw error; }
      }
      try {
        await apiRequest(`/api/v1/organisations/${created.id}/tracking-accounts`, {
          method: "POST", body: JSON.stringify({ name: "Cash", kind: "cash_label", openingBalanceKobo: "0", openingBalanceDate: new Date().toISOString().slice(0, 10) }),
        }, `setup:${created.id}:account:cash`);
      } catch (error) { if (!(error instanceof ClientApiError && error.status === 409)) throw error; }
      await loadDataForWorkspace(created.id);
      setToastBanner("Workspace created. Add your business tracking labels and opening balances in Settings.");
    } catch (error) {
      setBootstrapError(error instanceof Error ? error.message : "Workspace setup failed.");
    } finally { setSetupBusy(false); }
  };

  const handleNavigate = (tab: NavTab, filterHint?: string) => {
    setActiveTab(tab);
    if (tab === "transactions" && filterHint) {
      setTxTypeFilterHint(filterHint);
    } else if (tab === "transactions") {
      setTxTypeFilterHint("all");
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const apiRoot = `/api/v1/organisations/${encodeURIComponent(state.workspace.id)}`;
  const runMutation = async (action: () => Promise<unknown>, successMessage: string) => {
    try {
      await action();
      await loadDataForWorkspace(state.workspace.id);
      setToastBanner(successMessage);
    } catch (error) {
      try { await loadDataForWorkspace(state.workspace.id); } catch { /* keep the action error visible */ }
      setToastBanner(error instanceof Error ? error.message : "The action could not be completed.");
    }
  };

  // --- Domain Mutations ---
  const handleCreateTransaction: React.ComponentProps<typeof TransactionsView>["onCreateTransaction"] = async (payload) => {
    const key = newIdempotencyKey("transaction-create");
    await runMutation(async () => {
      const created = await apiRequest<{ id: string }>(`${apiRoot}/transactions`, {
        method: "POST", body: JSON.stringify({
          date: payload.date, description: payload.description, type: payload.type, direction: payload.direction,
          amountKobo: String(payload.amountKobo), categoryId: payload.categoryId || null,
          trackingAccountId: payload.trackingAccountId, transferToAccountId: payload.transferToAccountId || null,
          contactId: payload.contactId || null, reference: payload.reference || null, notes: payload.notes || null,
        }),
      }, key);
      if (payload.status === "posted") await apiRequest(`${apiRoot}/transactions/${created.id}/post`, { method: "POST" }, newIdempotencyKey("transaction-post"));
    }, `${payload.status === "posted" ? "Posted" : "Saved draft"}: ${payload.description}`);
  };

  const handlePostDraftTransaction = async (txId: string) => {
    await runMutation(() => apiRequest(`${apiRoot}/transactions/${txId}/post`, { method: "POST" }, newIdempotencyKey("transaction-post")), "Draft transaction posted to ledger.");
  };

  const handleReverseTransaction = async (
    txId: string,
    reason: string,
    replacementAmountKobo?: number,
  ) => {
    const original = state.transactions.find((transaction) => transaction.id === txId);
    if (!original) return;
    await runMutation(async () => {
      await apiRequest(`${apiRoot}/transactions/${txId}/reverse`, { method: "POST", body: JSON.stringify({ reason }) }, newIdempotencyKey("transaction-reverse"));
      if (replacementAmountKobo && replacementAmountKobo > 0) {
        const replacement = await apiRequest<{ id: string }>(`${apiRoot}/transactions`, {
          method: "POST", body: JSON.stringify({
            date: original.date, description: `${original.description} (Corrected entry)`, type: original.type,
            direction: original.direction, amountKobo: String(replacementAmountKobo), categoryId: original.categoryId || null,
            trackingAccountId: original.trackingAccountId, transferToAccountId: original.transferToAccountId || null,
            contactId: original.contactId || null, reference: original.reference || null,
          }),
        }, newIdempotencyKey("transaction-replacement"));
        await apiRequest(`${apiRoot}/transactions/${replacement.id}/post`, { method: "POST" }, newIdempotencyKey("transaction-post"));
      }
    }, replacementAmountKobo ? "Entry reversed and corrected replacement recorded." : "Entry reversed with an audited offsetting transaction.");
  };

  const handlePreviewCsvImport: React.ComponentProps<typeof TransactionsView>["onPreviewCsvImport"] = async (payload) => {
    return apiRequest(`${apiRoot}/imports/preview`, {
      method: "POST", body: JSON.stringify({
        fileName: payload.fileName, csv: payload.csv, trackingAccountId: payload.trackingAccountId,
        mapping: payload.mapping,
        options: { dateFormat: payload.dateFormat, decimalSeparator: payload.decimalSeparator },
      }),
    }, newIdempotencyKey("import-preview"));
  };

  const handleCommitCsvImport: React.ComponentProps<typeof TransactionsView>["onCommitCsvImport"] = async ({ batchId, fileName, rows }) => {
    const items = rows.filter((row) => row.serverRowId && row.status !== "error").map((row) => ({
      rowId: row.serverRowId, decision: row.decision,
      categoryId: row.decision === "include" ? row.categoryId || null : null,
    }));
    await runMutation(() => apiRequest(`${apiRoot}/imports/${batchId}/commit`, {
      method: "POST", body: JSON.stringify({ items }),
    }, newIdempotencyKey("import-commit")), `CSV import "${fileName}" committed with provenance.`);
  };

  const handleCreateInvoice: React.ComponentProps<typeof InvoicesView>["onCreateInvoice"] = async (payload) => {
    await runMutation(async () => {
      const invoice = await apiRequest<{ id: string }>(`${apiRoot}/invoices`, {
        method: "POST", body: JSON.stringify({
          invoiceNumber: payload.invoiceNumber, customerId: payload.customerId, issueDate: payload.issueDate, dueDate: payload.dueDate,
          lines: payload.lines.map((line) => ({ description: line.description, quantity: line.quantity.toFixed(3), unitPriceKobo: String(line.unitPriceKobo) })),
          discountKobo: String(payload.discountKobo), taxLabel: payload.taxLabel, taxRatePercent: payload.taxRatePercent.toFixed(2),
          terms: payload.terms, paymentInstructions: payload.paymentInstructions, notes: payload.notes,
        }),
      }, newIdempotencyKey("invoice-create"));
      if (payload.status === "shared") await apiRequest(`${apiRoot}/invoices/${invoice.id}/mark-shared`, { method: "POST" }, newIdempotencyKey("invoice-share"));
    }, `Invoice ${payload.invoiceNumber} ${payload.status === "shared" ? "marked as shared" : "saved as a draft"}.`);
  };

  const handleUpdateInvoiceStatus = async (invoiceId: string, status: WorkspaceState["invoices"][number]["status"]) => {
    if (status === "shared") {
      await runMutation(
        () => apiRequest(`${apiRoot}/invoices/${invoiceId}/mark-shared`, { method: "POST" }, newIdempotencyKey("invoice-share")),
        "Invoice marked as shared. No email was sent.",
      );
      return;
    }
    if (status === "disputed" || status === "cancelled") {
      await runMutation(
        () => apiRequest(`${apiRoot}/invoices/${invoiceId}`, { method: "PATCH", body: JSON.stringify({ status }) }, newIdempotencyKey(`invoice-${status}`)),
        `Invoice marked as ${status}.`,
      );
    }
  };

  const handleRecordReceipt: React.ComponentProps<typeof InvoicesView>["onRecordReceipt"] = async (payload) => {
    await runMutation(() => apiRequest(`${apiRoot}/invoices/${payload.invoiceId}/receipts`, {
      method: "POST", body: JSON.stringify({
        amountKobo: String(payload.amountKobo), date: payload.date, methodLabel: payload.methodLabel,
        reference: payload.reference, trackingAccountId: payload.trackingAccountId, confirmReceived: true,
      }),
    }, newIdempotencyKey("invoice-receipt")), `Recorded receipt of ${formatNgn(payload.amountKobo)}.`);
  };

  const handleSendReminder = async (invoiceId: string) => {
    await runMutation(
      () =>
        apiRequest(
          `${apiRoot}/invoices/${invoiceId}`,
          { method: "PATCH", body: JSON.stringify({ recordReminder: true }) },
          newIdempotencyKey("invoice-reminder"),
        ),
      "Reminder draft copied and logged in audit history. Share it directly with your customer.",
    );
  };

  const handleCreateContact: React.ComponentProps<typeof ContactsAndBillsView>["onCreateContact"] = async (payload) => {
    await runMutation(() => apiRequest(`${apiRoot}/contacts`, {
      method: "POST", body: JSON.stringify(payload),
    }, newIdempotencyKey("contact-create")), `Saved contact: ${payload.name}`);
  };

  const handleCreateBill: React.ComponentProps<typeof ContactsAndBillsView>["onCreateBill"] = async (payload) => {
    await runMutation(() => apiRequest(`${apiRoot}/supplier-bills`, {
      method: "POST", body: JSON.stringify({ ...payload, amountKobo: String(payload.amountKobo) }),
    }, newIdempotencyKey("bill-create")), `Supplier bill ${payload.billNumber} recorded.`);
  };

  const handleRecordBillPayment: React.ComponentProps<
    typeof ContactsAndBillsView
  >["onRecordBillPayment"] = async ({ billId, amountKobo, trackingAccountId, reference }) => {
    await runMutation(() => apiRequest(`${apiRoot}/supplier-bills/${billId}/payments`, {
      method: "POST", body: JSON.stringify({ amountKobo: String(amountKobo), date: new Date().toISOString().slice(0, 10), trackingAccountId, reference }),
    }, newIdempotencyKey("bill-payment")), `Recorded bookkeeping payment (${formatNgn(amountKobo)}).`);
  };

  const handleExportReport = async (type: "income-expense" | "cash-movement" | "receivables" | "payables", from: string, to: string) => {
    const query = new URLSearchParams({ type, from, to, format: "csv" });
    const response = await fetch(`${apiRoot}/reports?${query}`, { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      throw new Error(payload?.error?.message || "Could not export this report.");
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `ledgerly-${type}-${from}-${to}.csv`;
    link.click();
    URL.revokeObjectURL(objectUrl);
  };

  if (bootstrapStatus === "loading") return <main className="connection-state" role="status">Loading your Ledgerly workspace…</main>;
  if (bootstrapStatus === "signed-out") return <main className="connection-state"><h1>Sign in to Ledgerly</h1><p>Your business records are available after signing in.</p><a className="primary" href="/login">Continue to sign in</a></main>;
  if (bootstrapStatus === "error") return <main className="connection-state"><h1>Workspace unavailable</h1><p role="alert">{bootstrapError}</p><button className="primary" type="button" onClick={() => { setBootstrapStatus("loading"); void loadDataForWorkspace().catch((error: unknown) => { setBootstrapError(error instanceof Error ? error.message : "Could not load Ledgerly."); setBootstrapStatus("error"); }); }}>Try again</button><a className="secondary-btn" href="/login">Sign in again</a></main>;
  if (bootstrapStatus === "needs-workspace") return (
    <main className="connection-state setup-state">
      <div className="setup-card">
        <span className="brand-mark">l</span><p className="eyebrow">LEDGERLY WORKSPACE SETUP</p>
        <h1>Set up your business workspace</h1>
        <p>Ledgerly keeps bookkeeping records for your team. It does not connect to or move money from your bank.</p>
        <form className="form-grid" onSubmit={createWorkspace}>
          <label className="form-field"><span>Legal business name *</span><input required maxLength={160} value={setupForm.legalName} onChange={(event) => setSetupForm({ ...setupForm, legalName: event.target.value })} /></label>
          <label className="form-field"><span>Workspace display name *</span><input required maxLength={100} value={setupForm.displayName} onChange={(event) => setSetupForm({ ...setupForm, displayName: event.target.value })} /></label>
          <label className="form-field"><span>Business type *</span><select value={setupForm.businessType} onChange={(event) => setSetupForm({ ...setupForm, businessType: event.target.value })}><option>Professional Services</option><option>Service &amp; Creative</option><option>Retail &amp; Trade</option><option>Distribution</option><option>Light Manufacturing</option></select></label>
          <label className="form-field"><span>City or state</span><input maxLength={120} placeholder="Lagos, Lagos State" value={setupForm.stateCity} onChange={(event) => setSetupForm({ ...setupForm, stateCity: event.target.value })} /></label>
          {bootstrapError && <p className="form-error full-span" role="alert">{bootstrapError}</p>}
          <button className="primary full-span" type="submit" disabled={setupBusy}>{setupBusy ? "Creating workspace…" : "Create workspace"}</button>
        </form>
      </div>
    </main>
  );

  return (
    <main className="shell">
      {/* Desktop & Tablet Sidebar */}
      <aside className="sidebar">
        <a
          className="brand"
          href="#overview"
          onClick={(e) => {
            e.preventDefault();
            handleNavigate("overview");
          }}
        >
          <span className="brand-mark">l</span> ledgerly
        </a>

        <div className="workspace">
          <span className="avatar" aria-hidden="true">{state.workspace.displayName.slice(0, 1).toUpperCase()}</span>
          {workspaceOptions.length > 1 ? <label className="workspace-select-label"><span className="sr-only">Current workspace</span><select aria-label="Current workspace" value={state.workspace.id} onChange={(event) => { setBootstrapStatus("loading"); void loadDataForWorkspace(event.target.value).catch((error: unknown) => { setBootstrapError(error instanceof Error ? error.message : "Could not switch workspaces."); setBootstrapStatus("error"); }); }}>{workspaceOptions.map((option) => <option key={option.id} value={option.id}>{option.displayName}</option>)}</select><small>{state.workspace.stateCity || "NGN workspace"} · NGN</small></label> : <span><b>{state.workspace.displayName}</b><small>{state.workspace.stateCity || "NGN workspace"} · NGN</small></span>}
        </div>

        <nav aria-label="Main navigation">
          {(
            [
              { id: "overview", icon: "◫", label: "Overview" },
              { id: "transactions", icon: "↕", label: "Transactions" },
              { id: "invoices", icon: "▤", label: "Invoices" },
              { id: "customers", icon: "♙", label: "Customers" },
              { id: "suppliers", icon: "◇", label: "Suppliers" },
              { id: "cashflow", icon: "⌁", label: "Cash flow" },
              { id: "reports", icon: "▥", label: "Reports" },
              { id: "team", icon: "⊕", label: "Team & Audit" },
              { id: "settings", icon: "⚙", label: "Settings" },
            ] as const
          ).filter((item) => {
            if (item.id === "team") return hasCapability(activeMember.role, "audit:view_own") || hasCapability(activeMember.role, "audit:view_all") || hasCapability(activeMember.role, "workspace:manage_members");
            if (item.id === "settings") return hasCapability(activeMember.role, "workspace:manage_settings");
            if (item.id === "cashflow" || item.id === "reports") return hasCapability(activeMember.role, "report:view");
            return true;
          }).map((item) => (
            <button
              key={item.id}
              type="button"
              className={`nav-item ${activeTab === item.id ? "active" : ""}`}
              onClick={() => handleNavigate(item.id)}
            >
              <span>{item.icon}</span> {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <button
            type="button"
            className="onboarding-pill"
            onClick={() => setShowOnboardingModal(true)}
          >
            <span>✓</span> Setup checklist ({setupProgress}/5)
          </button>

          <div className="profile">
            <span className="avatar owner">
              {activeMember.name
                .split(" ")
                .map((n) => n[0])
                .join("")
                .slice(0, 2)}
            </span>
            <span style={{ minWidth: 0 }}>
              <b>{activeMember.name}</b>
              <small>{ROLE_DESCRIPTIONS[activeMember.role].label}</small>
            </span>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <section className="content">
        <header className="topbar">
          <div className="mobile-brand">
            <span className="brand-mark">l</span> ledgerly
          </div>

          <div className="crumb">
            {state.workspace.displayName} <span>/</span>{" "}
            <b style={{ color: "var(--text)", textTransform: "capitalize" }}>{activeTab}</b>
          </div>

          <div className="top-actions">
            <button type="button" className="secondary-btn workspace-refresh" onClick={() => void refreshWorkspace()} aria-label="Refresh workspace data">Refresh</button>
            <button
              type="button"
              className="icon-button"
              aria-label="Global Search"
              title="Search records"
              onClick={() => setGlobalSearchOpen(true)}
            >
              ⌕
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Notifications"
              title="Notifications"
              onClick={() => setShowNotifications((v) => !v)}
            >
              🔔
            </button>
            <button
              type="button"
              className="help"
              onClick={() => setShowHelpModal(true)}
            >
              Help & Feedback
            </button>
            <button type="button" className="secondary-btn sign-out-button" onClick={() => void signOut({ redirectTo: "/login" })}>Sign out</button>
          </div>
        </header>

        <div className="live-banner" role="status">
          <strong>Live workspace</strong>
          <span>Showing records stored for {state.workspace.displayName}. Server permissions control every change.</span>
        </div>

        {/* Non-blocking Toast Banner */}
        {toastBanner && (
          <div className="toast-banner" role="status">
            <span>✓ {toastBanner}</span>
            <button
              type="button"
              className="close-btn"
              onClick={() => setToastBanner(null)}
            >
              ✕
            </button>
          </div>
        )}
        {invitationLink && <div className="toast-banner invitation-link-banner" role="status"><label><span>Invitation link</span><input readOnly value={invitationLink} onFocus={(event) => event.currentTarget.select()} /></label><button type="button" className="secondary-btn" onClick={() => { void navigator.clipboard.writeText(invitationLink).then(() => setToastBanner("Invitation link copied."), () => setToastBanner("Select and copy the invitation link above.")); }}>Copy link</button><button type="button" className="close-btn" aria-label="Hide invitation link" onClick={() => setInvitationLink("")}>✕</button></div>}

        {/* Read-only Role Banner when viewing as External Accountant */}
        {activeMember.role === "accountant" && (
          <div className="accountant-banner">
            <span>👁</span>
            <span>
              <b>Read-only Accountant Mode ({activeMember.name}):</b> You can inspect all records, Money Brief evidence, reports, exports, and the full audit trail. Create, edit, post, and reversal controls are disabled for your role.
            </span>
          </div>
        )}

        {/* Active Screen View */}
        {activeTab === "overview" && (
          <OverviewView
            state={state}
            canWriteTransactions={hasCapability(activeMember.role, "transaction:create_edit")}
            onNavigate={handleNavigate}
            onOpenNewTransaction={() => {
              setActiveTab("transactions");
              setTxModalSignal("new_tx");
            }}
            onOpenCsvImport={() => {
              setActiveTab("transactions");
              setTxModalSignal("csv_import");
            }}
            onDismissObservation={(id) => {
              const nextDismissed = [...new Set([...state.dismissedObservationIds, id])];
              setState((prev) => ({
                ...prev,
                dismissedObservationIds: nextDismissed,
              }));
              void apiRequest(
                `${apiRoot}/settings`,
                { method: "PATCH", body: JSON.stringify({ dismissedObservations: nextDismissed }) },
                newIdempotencyKey("obs-dismiss"),
              ).catch(() => undefined);
            }}
            onMarkObservationReviewed={(id) => {
              const nextReviewed = {
                ...state.reviewedObservationIds,
                [id]: new Date().toISOString().slice(0, 10),
              };
              setState((prev) => ({
                ...prev,
                reviewedObservationIds: nextReviewed,
              }));
              void apiRequest(
                `${apiRoot}/settings`,
                { method: "PATCH", body: JSON.stringify({ reviewedObservations: Object.keys(nextReviewed) }) },
                newIdempotencyKey("obs-review"),
              ).catch(() => undefined);
            }}
            onRestoreObservations={() => {
              setState((prev) => ({ ...prev, dismissedObservationIds: [] }));
              void apiRequest(
                `${apiRoot}/settings`,
                { method: "PATCH", body: JSON.stringify({ dismissedObservations: [] }) },
                newIdempotencyKey("obs-restore"),
              ).catch(() => undefined);
            }}
          />
        )}

        {activeTab === "transactions" && (
          <TransactionsView
            state={state}
            initialTypeFilter={txTypeFilterHint}
            canWrite={hasCapability(activeMember.role, "transaction:create_edit")}
            canReverse={hasCapability(activeMember.role, "transaction:reverse")}
            canImport={hasCapability(activeMember.role, "import:run")}
            openModalSignal={txModalSignal}
            onClearModalSignal={() => setTxModalSignal(null)}
            onCreateTransaction={handleCreateTransaction}
            onPostDraftTransaction={handlePostDraftTransaction}
            onReverseTransaction={handleReverseTransaction}
            onPreviewCsvImport={handlePreviewCsvImport}
            onCommitCsvImport={handleCommitCsvImport}
          />
        )}

        {activeTab === "invoices" && (
          <InvoicesView
            state={state}
            canCreateSend={hasCapability(activeMember.role, "invoice:create_send")}
            canRecordReceipt={hasCapability(activeMember.role, "invoice:record_receipt")}
            onCreateInvoice={handleCreateInvoice}
            onUpdateInvoiceStatus={handleUpdateInvoiceStatus}
            onRecordReceipt={handleRecordReceipt}
            onSendReminder={handleSendReminder}
          />
        )}

        {(activeTab === "customers" || activeTab === "suppliers") && (
          <ContactsAndBillsView
            mode={activeTab}
            state={state}
            canWrite={hasCapability(activeMember.role, "bill:create_update")}
            onCreateContact={handleCreateContact}
            onCreateBill={handleCreateBill}
            onRecordBillPayment={handleRecordBillPayment}
            onToggleArchiveContact={async (contactId, nextStatus) => {
              await runMutation(
                () =>
                  apiRequest(
                    `${apiRoot}/contacts/${contactId}`,
                    { method: "PATCH", body: JSON.stringify({ status: nextStatus }) },
                    newIdempotencyKey("contact-status"),
                  ),
                `Contact ${nextStatus === "archived" ? "archived" : "restored"}.`,
              );
            }}
            onCancelBill={async (billId) => {
              await runMutation(
                () =>
                  apiRequest(
                    `${apiRoot}/supplier-bills/${billId}`,
                    { method: "PATCH", body: JSON.stringify({ status: "cancelled" }) },
                    newIdempotencyKey("bill-cancel"),
                  ),
                "Supplier bill cancelled.",
              );
            }}
          />
        )}

        {(activeTab === "cashflow" || activeTab === "reports") && (
          <CashFlowAndReportsView
            mode={activeTab}
            state={state}
            canExport={hasCapability(activeMember.role, "report:export")}
            onExportReport={handleExportReport}
          />
        )}

        {(activeTab === "team" || activeTab === "settings") && (
          <TeamAuditSettingsView
            mode={activeTab}
            state={state}
            activeRole={activeMember.role}
            canManageMembers={hasCapability(activeMember.role, "workspace:manage_members")}
            canManageSettings={hasCapability(activeMember.role, "workspace:manage_settings")}
            canManageCategories={hasCapability(activeMember.role, "category:manage")}
            canViewAllAudit={hasCapability(activeMember.role, "audit:view_all")}
            onInviteMember={async ({ name, email, role }) => {
              try {
                const result = await apiRequest<{ acceptUrl: string }>(`${apiRoot}/members/invitations`, {
                  method: "POST", body: JSON.stringify({ name, email, role }),
                }, newIdempotencyKey("member-invite"));
                setInvitationLink(result.acceptUrl);
                try { await navigator.clipboard.writeText(result.acceptUrl); setToastBanner(`Invitation link copied for ${name}. Share it directly with the invitee.`); }
                catch { setToastBanner("Invitation created. Copy the link shown below and share it with the invitee."); }
                await loadDataForWorkspace(state.workspace.id);
              } catch (error) { setToastBanner(error instanceof Error ? error.message : "Could not create the invitation."); }
            }}
            onToggleMemberStatus={async (memberId) => {
              const target = state.members.find((member) => member.id === memberId);
              if (!target) return;
              const status = target.status === "active" ? "deactivated" : "active";
              await runMutation(() => apiRequest(`${apiRoot}/members/${encodeURIComponent(memberId)}`, {
                method: "PATCH", body: JSON.stringify({ status }),
              }, newIdempotencyKey("member-status")), `Member access ${status}.`);
            }}
            onChangeMemberRole={async (memberId, role) => {
              await runMutation(() => apiRequest(`${apiRoot}/members/${encodeURIComponent(memberId)}`, {
                method: "PATCH", body: JSON.stringify({ role }),
              }, newIdempotencyKey("member-role")), "Member role updated.");
            }}
            onUpdateWorkspaceProfile={async (payload) => {
              await runMutation(() => apiRequest(`${apiRoot}/settings`, {
                method: "PATCH", body: JSON.stringify({ ...payload, lowCashThresholdKobo: String(payload.lowCashThresholdKobo) }),
              }, newIdempotencyKey("workspace-settings")), "Workspace profile saved.");
            }}
            onAddCategory={async ({ name, type }) => {
              await runMutation(() => apiRequest(`${apiRoot}/categories`, { method: "POST", body: JSON.stringify({ name, type }) }, newIdempotencyKey("category-create")), `Category "${name}" added.`);
            }}
            onToggleArchiveCategory={async (categoryId) => {
              const category = state.categories.find((item) => item.id === categoryId);
              if (!category) return;
              await runMutation(() => apiRequest(`${apiRoot}/categories/${categoryId}`, {
                method: "PATCH", body: JSON.stringify({ archived: !category.archived }),
              }, newIdempotencyKey("category-archive")), `Category ${category.archived ? "restored" : "archived"}.`);
            }}
            onAddTrackingAccount={async ({ name, kind, maskedRef, openingBalanceKobo }) => {
              await runMutation(() => apiRequest(`${apiRoot}/tracking-accounts`, {
                method: "POST", body: JSON.stringify({ name, kind, maskedRef, openingBalanceKobo: String(openingBalanceKobo), openingBalanceDate: new Date().toISOString().slice(0, 10) }),
              }, newIdempotencyKey("tracking-account-create")), `Tracking label "${name}" added.`);
            }}
            onToggleArchiveTrackingAccount={async (accountId) => {
              const target = state.trackingAccounts.find((a) => a.id === accountId);
              if (!target) return;
              await runMutation(
                () =>
                  apiRequest(
                    `${apiRoot}/tracking-accounts/${accountId}`,
                    { method: "PATCH", body: JSON.stringify({ archived: !target.archived }) },
                    newIdempotencyKey("tracking-account-archive"),
                  ),
                `Tracking label ${target.archived ? "restored" : "archived"}.`,
              );
            }}
            onRevokeOtherSessions={async () => {
              await runMutation(
                () =>
                  apiRequest(
                    `${apiRoot}/sessions`,
                    { method: "POST" },
                    newIdempotencyKey("sessions-revoke"),
                  ),
                "Other active workspace sessions have been revoked.",
              );
            }}
          />
        )}

        <footer>
          Ledgerly shows records provided by your business. Recorded cash is a calculation from those records, not a live bank balance. Ledgerly does not hold funds, initiate transfers, provide lending, or issue NRS-certified fiscal e-invoices.
        </footer>

        {/* Mobile Bottom Navigation */}
        <nav className="mobile-nav" aria-label="Mobile navigation">
          <button
            type="button"
            className={activeTab === "overview" ? "selected" : ""}
            onClick={() => handleNavigate("overview")}
          >
            ◫<small>Home</small>
          </button>
          <button
            type="button"
            className={activeTab === "transactions" ? "selected" : ""}
            onClick={() => handleNavigate("transactions")}
          >
            ↕<small>Transactions</small>
          </button>
          <button
            type="button"
            className={activeTab === "invoices" ? "selected" : ""}
            onClick={() => handleNavigate("invoices")}
          >
            ▤<small>Invoices</small>
          </button>
          <button
            type="button"
            className={
              ["customers", "suppliers", "cashflow", "reports", "team", "settings"].includes(
                activeTab,
              )
                ? "selected"
                : ""
            }
            aria-haspopup="dialog"
            aria-expanded={showMobileMore}
            onClick={() => setShowMobileMore((open) => !open)}
          >
            ☰<small>More</small>
          </button>
        </nav>

        {showMobileMore && (
          <div
            className="mobile-more-backdrop"
            role="presentation"
            onClick={() => setShowMobileMore(false)}
          >
            <section
              className="mobile-more-sheet"
              role="dialog"
              aria-modal="true"
              aria-labelledby="mobile-more-title"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mobile-more-heading">
                <h2 id="mobile-more-title">More</h2>
                <button type="button" className="close-btn" aria-label="Close menu" onClick={() => setShowMobileMore(false)}>✕</button>
              </div>
              <nav aria-label="More navigation">
                {mobileMoreItems
                  .filter((item) =>
                    item.id === "team"
                      ? hasCapability(activeMember.role, "audit:view_own") ||
                        hasCapability(activeMember.role, "audit:view_all")
                      : !item.capability || hasCapability(activeMember.role, item.capability),
                  )
                  .map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      className={activeTab === item.id ? "selected" : ""}
                      onClick={() => {
                        setShowMobileMore(false);
                        handleNavigate(item.id);
                      }}
                    >
                      <span aria-hidden="true">{item.icon}</span>{item.label}<span aria-hidden="true">›</span>
                    </button>
                  ))}
                <button type="button" onClick={() => { setShowMobileMore(false); setShowHelpModal(true); }}>
                  <span aria-hidden="true">?</span>Help & feedback<span aria-hidden="true">›</span>
                </button>
              </nav>
            </section>
          </div>
        )}
      </section>

      {/* Global Search Modal */}
      {globalSearchOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="gsearch-title">
          <div className="modal-card">
            <div className="modal-header">
              <div>
                <span className="brief-label">WORKSPACE SEARCH (FR-13)</span>
                <h2 id="gsearch-title">Search transactions, invoices & contacts</h2>
              </div>
              <button
                type="button"
                className="close-btn"
                onClick={() => setGlobalSearchOpen(false)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <input
                type="search"
                className="search-input"
                style={{ width: "100%", marginBottom: 14 }}
                placeholder="Type invoice number, customer name, description, or reference…"
                value={globalSearchQuery}
                onChange={(e) => setGlobalSearchQuery(e.target.value)}
                autoFocus
              />

              {globalSearchQuery.trim() && (
                <div>
                  <h4>Matching Transactions</h4>
                  {state.transactions
                    .filter(
                      (t) =>
                        t.description.toLowerCase().includes(globalSearchQuery.toLowerCase()) ||
                        (t.reference ?? "").toLowerCase().includes(globalSearchQuery.toLowerCase()),
                    )
                    .map((tx) => (
                      <div key={tx.id} className="attention-row">
                        <span>
                          <b>{tx.description}</b>
                          <small>
                            {formatDisplayDate(tx.date)} · {tx.reference ?? "No ref"}
                          </small>
                        </span>
                        <strong>{formatNgn(tx.amountKobo)}</strong>
                      </div>
                    ))}

                  <h4 style={{ marginTop: 14 }}>Matching Invoices</h4>
                  {state.invoices
                    .filter((i) =>
                      i.invoiceNumber.toLowerCase().includes(globalSearchQuery.toLowerCase()),
                    )
                    .map((inv) => (
                      <div key={inv.id} className="attention-row">
                        <span>
                          <b>{inv.invoiceNumber}</b>
                          <small>Due {formatDisplayDate(inv.dueDate)}</small>
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Notifications Modal */}
      {showNotifications && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="notif-title">
          <div className="modal-card">
            <div className="modal-header">
              <div>
                <span className="brief-label">IN-APP & EMAIL ALERTS (FR-14)</span>
                <h2 id="notif-title">Notifications</h2>
              </div>
              <button
                type="button"
                className="close-btn"
                onClick={() => setShowNotifications(false)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              {overdueInvoices.map((invoice) => <div className="attention-row" key={invoice.id}><span className="attention-icon amber">↗</span><span><b>{invoice.invoiceNumber} is overdue</b><small>Due {formatDisplayDate(invoice.dueDate)} · Review in Invoices</small></span><button type="button" className="text-btn" onClick={() => { setShowNotifications(false); handleNavigate("invoices"); }}>Open</button></div>)}
              {dueBills.map((bill) => { const due = computeBillStatus(bill); return <div className="attention-row" key={bill.id}><span className="attention-icon blue">◷</span><span><b>Supplier bill {bill.billNumber} {due.isOverdue ? "is overdue" : "is due soon"}</b><small>Due {formatDisplayDate(bill.dueDate)} · Bookkeeping record</small></span><button type="button" className="text-btn" onClick={() => { setShowNotifications(false); handleNavigate("suppliers"); }}>Open</button></div>; })}
              {!overdueInvoices.length && !dueBills.length && <p className="empty-card">No overdue invoices or bills due within the next seven days.</p>}
            </div>
          </div>
        </div>
      )}

      {/* First-Time Setup / Onboarding Checklist Modal (FR-01) */}
      {showOnboardingModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="onb-title">
          <div className="modal-card">
            <div className="modal-header">
              <div>
                <span className="brief-label">WORKSPACE ONBOARDING PROGRESS (FR-01)</span>
                <h2 id="onb-title">Workspace setup checklist ({setupProgress}/5)</h2>
              </div>
              <button
                type="button"
                className="close-btn"
                onClick={() => setShowOnboardingModal(false)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <ul className="role-list">
                <li>
                  {currentUser?.id ? "✓" : "○"} <b>Step 1 — Account:</b> {currentUser?.name || currentUser?.email || "Signed in user"}
                </li>
                <li>
                  {state.workspace.legalName ? "✓" : "○"} <b>Step 2 — Business profile:</b> {state.workspace.legalName} ({state.workspace.stateCity || "Add a business location in Settings"}).
                </li>
                <li>
                  ✓ <b>Step 3 — Financial defaults:</b> {state.workspace.baseCurrency} (₦) base currency, {state.workspace.timezone} timezone, financial year starts in month {state.workspace.financialYearStartMonth}.
                </li>
                <li>
                  {state.trackingAccounts.length ? "✓" : "○"} <b>Step 4 — Tracking labels:</b> {state.trackingAccounts.length} non-custodial bookkeeping label(s) configured with recorded opening balances.
                </li>
                <li>
                  {state.transactions.length || state.members.length > 1 ? "✓" : "○"} <b>Step 5 — First records and team:</b> {state.transactions.length} transaction(s), {state.members.length} member(s).
                </li>
              </ul>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="primary"
                onClick={() => setShowOnboardingModal(false)}
              >
                Continue to workspace
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Help & Feedback Modal (FR-15) */}
      {showHelpModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="help-title">
          <div className="modal-card">
            <div className="modal-header">
              <div>
                <span className="brief-label">CONTEXTUAL HELP & PRODUCT FEEDBACK (FR-15)</span>
                <h2 id="help-title">How Ledgerly works</h2>
              </div>
              <button
                type="button"
                className="close-btn"
                onClick={() => setShowHelpModal(false)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="field-block">
                <h4>Key concepts</h4>
                <p>
                  • <b>Recorded Cash vs Bank Balance:</b> Tracking labels (like GTBank ••2041 or POS settlement) are bookkeeping labels maintained by your business, not live bank connections.
                  <br />• <b>Safe Corrections:</b> Posted entries are never deleted or overwritten. Use “Correct/Reverse” to create an auditable offsetting entry.
                  <br />• <b>Ordinary Invoices:</b> Ledgerly invoices include your payment instructions and are not NRS-certified fiscal e-invoices.
                </p>
              </div>
              <label className="form-field full-span">
                <span>Report an issue or share pilot feedback</span>
                <textarea
                  rows={3}
                  placeholder="Tell us what worked well or what felt confusing…"
                  value={feedbackText}
                  onChange={(e) => setFeedbackText(e.target.value)}
                  className="code-textarea"
                />
              </label>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="secondary-btn"
                onClick={() => setShowHelpModal(false)}
              >
                Close
              </button>
              <button
                type="button"
                className="primary"
                onClick={async () => {
                  const message = feedbackText.trim();
                  if (message.length < 3) return;
                  await runMutation(
                    () =>
                      apiRequest(
                        `${apiRoot}/feedback`,
                        { method: "POST", body: JSON.stringify({ message }) },
                        newIdempotencyKey("feedback-submit"),
                      ),
                    "Feedback recorded in your workspace and audit log.",
                  );
                  setFeedbackText("");
                  setShowHelpModal(false);
                }}
              >
                Submit feedback
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
