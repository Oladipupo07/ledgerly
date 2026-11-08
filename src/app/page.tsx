"use client";

import React, { useState, useCallback } from "react";
import {
  WorkspaceState,
  TransactionRecord,
  Invoice,
  SupplierBill,
  AuditEvent,
  CURRENT_REFERENCE_DATE,
  formatDisplayDate,
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

export default function LedgerlyApp() {
  const [state, setState] = useState<WorkspaceState>(() => createInitialWorkspaceState());
  const [activeTab, setActiveTab] = useState<NavTab>("overview");
  const [txTypeFilterHint, setTxTypeFilterHint] = useState<string>("all");
  const [txModalSignal, setTxModalSignal] = useState<"new_tx" | "csv_import" | null>(null);

  // Active member switcher so reviewer can test Owner / Bookkeeper / External Accountant RBAC
  const [activeMemberId, setActiveMemberId] = useState<string>("mem-1");
  const activeMember =
    state.members.find((m) => m.id === activeMemberId && m.status === "active") ??
    state.members[0];

  // Global Header Modals
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [globalSearchQuery, setGlobalSearchQuery] = useState("");
  const [toastBanner, setToastBanner] = useState<string | null>(null);
  const [feedbackText, setFeedbackText] = useState("");

  const appendAudit = useCallback(
    (
      draft: Omit<AuditEvent, "id" | "organisationId" | "actorName" | "actorRole" | "timestamp">,
    ): AuditEvent => ({
      id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      organisationId: state.workspace.id,
      actorName: activeMember.name,
      actorRole: activeMember.role,
      timestamp: new Date().toISOString(),
      ...draft,
    }),
    [state.workspace.id, activeMember],
  );

  const handleNavigate = (tab: NavTab, filterHint?: string) => {
    setActiveTab(tab);
    if (tab === "transactions" && filterHint) {
      setTxTypeFilterHint(filterHint);
    } else if (tab === "transactions") {
      setTxTypeFilterHint("all");
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // --- Domain Mutations ---
  const handleCreateTransaction: React.ComponentProps<
    typeof TransactionsView
  >["onCreateTransaction"] = (payload) => {
    if (!hasCapability(activeMember.role, "transaction:create_edit")) {
      setToastBanner("Permission denied: Current role cannot create transactions.");
      return;
    }

    setState((prev) => {
      // Idempotency check
      const existing = prev.transactions.find(
        (t) => t.idempotencyKey && t.idempotencyKey === payload.idempotencyKey,
      );
      if (existing) {
        return prev;
      }

      const newTx: TransactionRecord = {
        id: `tx-${Date.now().toString().slice(-5)}`,
        organisationId: prev.workspace.id,
        date: payload.date,
        description: payload.description,
        type: payload.type,
        status: payload.status,
        amountKobo: payload.amountKobo,
        direction: payload.direction,
        categoryId: payload.categoryId,
        trackingAccountId: payload.trackingAccountId,
        transferToAccountId: payload.transferToAccountId,
        contactId: payload.contactId,
        reference: payload.reference,
        notes: payload.notes,
        source: "manual",
        createdBy: activeMember.name,
        createdAt: new Date().toISOString(),
        idempotencyKey: payload.idempotencyKey,
      };

      const audit = appendAudit({
        action: payload.status === "posted" ? "transaction.posted" : "transaction.draft_saved",
        entityType: "transaction",
        entityId: newTx.id,
        summary: `${payload.status === "posted" ? "Posted" : "Saved draft"} ${payload.type} "${payload.description}" for ${formatNgn(payload.amountKobo)}.`,
        afterSnapshot: `Status: ${payload.status} | Amount: ${formatNgn(payload.amountKobo)}`,
      });

      return {
        ...prev,
        transactions: [newTx, ...prev.transactions],
        auditEvents: [audit, ...prev.auditEvents],
      };
    });

    setToastBanner(
      `${payload.status === "posted" ? "Posted" : "Saved draft"} record: ${payload.description} (${formatNgn(payload.amountKobo)})`,
    );
  };

  const handlePostDraftTransaction = (txId: string) => {
    if (!hasCapability(activeMember.role, "transaction:post")) return;
    setState((prev) => {
      const target = prev.transactions.find((t) => t.id === txId);
      if (!target) return prev;
      const audit = appendAudit({
        action: "transaction.posted_from_draft",
        entityType: "transaction",
        entityId: txId,
        summary: `Posted draft transaction "${target.description}" (${formatNgn(target.amountKobo)}).`,
        beforeSnapshot: "Status: draft",
        afterSnapshot: "Status: posted",
      });
      return {
        ...prev,
        transactions: prev.transactions.map((t) =>
          t.id === txId ? { ...t, status: "posted" } : t,
        ),
        auditEvents: [audit, ...prev.auditEvents],
      };
    });
    setToastBanner("Draft transaction posted to ledger.");
  };

  const handleReverseTransaction = (
    txId: string,
    reason: string,
    replacementAmountKobo?: number,
  ) => {
    if (!hasCapability(activeMember.role, "transaction:reverse")) return;
    setState((prev) => {
      const original = prev.transactions.find((t) => t.id === txId);
      if (!original || original.status !== "posted") return prev;

      const reversalId = `tx-rev-${Date.now().toString().slice(-4)}`;
      const reversalEntry: TransactionRecord = {
        id: reversalId,
        organisationId: prev.workspace.id,
        date: CURRENT_REFERENCE_DATE,
        description: `Reversal of: ${original.description}`,
        type: original.type,
        status: "posted",
        amountKobo: original.amountKobo,
        direction: original.direction === "inflow" ? "outflow" : "inflow",
        categoryId: original.categoryId,
        trackingAccountId: original.trackingAccountId,
        contactId: original.contactId,
        reference: original.reference ? `REV-${original.reference}` : undefined,
        source: "reversal",
        reversesTransactionId: original.id,
        reversalReason: reason,
        createdBy: activeMember.name,
        createdAt: new Date().toISOString(),
      };

      const newEntries: TransactionRecord[] = [reversalEntry];
      if (replacementAmountKobo && replacementAmountKobo > 0) {
        newEntries.unshift({
          id: `tx-rep-${Date.now().toString().slice(-4)}`,
          organisationId: prev.workspace.id,
          date: original.date,
          description: `${original.description} (Corrected entry)`,
          type: original.type,
          status: "posted",
          amountKobo: replacementAmountKobo,
          direction: original.direction,
          categoryId: original.categoryId,
          trackingAccountId: original.trackingAccountId,
          contactId: original.contactId,
          reference: original.reference,
          source: "manual",
          reversalReason: `Replacement for ${original.id}: ${reason}`,
          createdBy: activeMember.name,
          createdAt: new Date().toISOString(),
        });
      }

      const audit = appendAudit({
        action: "transaction.reversed",
        entityType: "transaction",
        entityId: original.id,
        summary: `Reversed "${original.description}" (${formatNgn(original.amountKobo)}). Reason: ${reason}${
          replacementAmountKobo ? ` | Posted replacement: ${formatNgn(replacementAmountKobo)}` : ""
        }`,
        beforeSnapshot: `Status: posted | Amount: ${formatNgn(original.amountKobo)}`,
        afterSnapshot: `Status: reversed | Offsetting ID: ${reversalId}`,
      });

      return {
        ...prev,
        transactions: [
          ...newEntries,
          ...prev.transactions.map((t) =>
            t.id === original.id
              ? {
                  ...t,
                  status: "reversed" as const,
                  reversedByTransactionId: reversalId,
                  reversalReason: reason,
                }
              : t,
          ),
        ],
        auditEvents: [audit, ...prev.auditEvents],
      };
    });
    setToastBanner("Posted entry safely reversed with linked audit trail.");
  };

  const handleCommitCsvImport: React.ComponentProps<
    typeof TransactionsView
  >["onCommitCsvImport"] = ({ fileName, trackingAccountId, rows }) => {
    if (!hasCapability(activeMember.role, "import:run")) return;
    setState((prev) => {
      const batchId = `imp-${Date.now().toString().slice(-5)}`;
      const includedRows = rows.filter(
        (r) => r.decision === "include" && r.status !== "error" && r.amountKobo && r.parsedDate,
      );

      const importedTx: TransactionRecord[] = includedRows.map((r) => ({
        id: `tx-imp-${batchId}-${r.rowNumber}`,
        organisationId: prev.workspace.id,
        date: r.parsedDate!,
        description: r.rawDescription,
        type: r.direction === "inflow" ? "income" : "expense",
        status: "posted",
        amountKobo: r.amountKobo!,
        direction: r.direction!,
        categoryId: r.categoryId,
        trackingAccountId,
        reference: r.reference || undefined,
        source: "csv_import",
        importBatchId: batchId,
        createdBy: activeMember.name,
        createdAt: new Date().toISOString(),
      }));

      const newBatch = {
        id: batchId,
        organisationId: prev.workspace.id,
        fileName,
        trackingAccountId,
        uploadedBy: activeMember.name,
        uploadedAt: new Date().toISOString(),
        committedAt: new Date().toISOString(),
        totalRows: rows.length,
        committedCount: importedTx.length,
        skippedCount: rows.filter((r) => r.decision === "skip").length,
        errorCount: rows.filter((r) => r.status === "error").length,
        status: "committed" as const,
        rows,
      };

      const audit = appendAudit({
        action: "import.committed",
        entityType: "import",
        entityId: batchId,
        summary: `Committed CSV "${fileName}": ${importedTx.length} posted, ${newBatch.skippedCount} skipped.`,
        afterSnapshot: `Batch: ${batchId} | Committed: ${importedTx.length}`,
      });

      return {
        ...prev,
        transactions: [...importedTx, ...prev.transactions],
        importBatches: [newBatch, ...prev.importBatches],
        auditEvents: [audit, ...prev.auditEvents],
      };
    });
    setToastBanner(`CSV import "${fileName}" committed to ledger.`);
  };

  const handleCreateInvoice: React.ComponentProps<typeof InvoicesView>["onCreateInvoice"] = (
    payload,
  ) => {
    setState((prev) => {
      const inv: Invoice = {
        id: `inv-${Date.now().toString().slice(-5)}`,
        organisationId: prev.workspace.id,
        invoiceNumber: payload.invoiceNumber,
        customerId: payload.customerId,
        issueDate: payload.issueDate,
        dueDate: payload.dueDate,
        status: payload.status,
        lines: payload.lines,
        discountKobo: payload.discountKobo,
        taxLabel: payload.taxLabel,
        taxRatePercent: payload.taxRatePercent,
        terms: payload.terms,
        paymentInstructions: payload.paymentInstructions,
        notes: payload.notes,
        receipts: [],
        createdBy: activeMember.name,
        createdAt: new Date().toISOString(),
      };

      const audit = appendAudit({
        action: payload.status === "shared" ? "invoice.issued" : "invoice.draft_created",
        entityType: "invoice",
        entityId: inv.id,
        summary: `Created ${payload.status} invoice ${inv.invoiceNumber}.`,
      });

      return {
        ...prev,
        invoices: [inv, ...prev.invoices],
        auditEvents: [audit, ...prev.auditEvents],
      };
    });
    setToastBanner(`Invoice ${payload.invoiceNumber} created.`);
  };

  const handleUpdateInvoiceStatus = (
    invoiceId: string,
    status: Invoice["status"],
  ) => {
    setState((prev) => {
      const target = prev.invoices.find((i) => i.id === invoiceId);
      if (!target) return prev;
      const audit = appendAudit({
        action: "invoice.status_updated",
        entityType: "invoice",
        entityId: invoiceId,
        summary: `Updated ${target.invoiceNumber} state from ${target.status} to ${status}.`,
      });
      return {
        ...prev,
        invoices: prev.invoices.map((i) => (i.id === invoiceId ? { ...i, status } : i)),
        auditEvents: [audit, ...prev.auditEvents],
      };
    });
    setToastBanner("Invoice status updated.");
  };

  const handleRecordReceipt: React.ComponentProps<typeof InvoicesView>["onRecordReceipt"] = (
    payload,
  ) => {
    setState((prev) => {
      const target = prev.invoices.find((i) => i.id === payload.invoiceId);
      if (!target) return prev;

      const txId = `tx-rcp-${Date.now().toString().slice(-4)}`;
      const rcpId = `rcp-${Date.now().toString().slice(-4)}`;

      const newReceipt = {
        id: rcpId,
        invoiceId: target.id,
        date: payload.date,
        amountKobo: payload.amountKobo,
        methodLabel: payload.methodLabel,
        reference: payload.reference,
        trackingAccountId: payload.trackingAccountId,
        recordedBy: activeMember.name,
        recordedAt: new Date().toISOString(),
        transactionId: txId,
      };

      const newTx: TransactionRecord = {
        id: txId,
        organisationId: prev.workspace.id,
        date: payload.date,
        description: `Invoice receipt · ${target.invoiceNumber}`,
        type: "income",
        status: "posted",
        amountKobo: payload.amountKobo,
        direction: "inflow",
        categoryId: prev.categories.find((c) => c.type === "income")?.id ?? "cat-sales",
        trackingAccountId: payload.trackingAccountId,
        contactId: target.customerId,
        reference: payload.reference,
        source: "invoice_receipt",
        invoiceId: target.id,
        createdBy: activeMember.name,
        createdAt: new Date().toISOString(),
      };

      const audit = appendAudit({
        action: "invoice.receipt_recorded",
        entityType: "invoice",
        entityId: target.id,
        summary: `Recorded customer receipt of ${formatNgn(payload.amountKobo)} against ${target.invoiceNumber} (Ref: ${payload.reference}).`,
      });

      return {
        ...prev,
        invoices: prev.invoices.map((inv) =>
          inv.id === target.id
            ? {
                ...inv,
                status: "partially_paid",
                receipts: [...inv.receipts, newReceipt],
              }
            : inv,
        ),
        transactions: [newTx, ...prev.transactions],
        auditEvents: [audit, ...prev.auditEvents],
      };
    });
    setToastBanner(`Recorded receipt of ${formatNgn(payload.amountKobo)}.`);
  };

  const handleSendReminder = (invoiceId: string) => {
    setState((prev) => {
      const target = prev.invoices.find((i) => i.id === invoiceId);
      if (!target) return prev;
      const audit = appendAudit({
        action: "invoice.reminder_sent",
        entityType: "invoice",
        entityId: invoiceId,
        summary: `Reviewed and logged overdue payment reminder for ${target.invoiceNumber}.`,
      });
      return {
        ...prev,
        invoices: prev.invoices.map((i) =>
          i.id === invoiceId ? { ...i, lastReminderSentAt: new Date().toISOString() } : i,
        ),
        auditEvents: [audit, ...prev.auditEvents],
      };
    });
    setToastBanner("Payment reminder logged and sent.");
  };

  const handleCreateContact: React.ComponentProps<
    typeof ContactsAndBillsView
  >["onCreateContact"] = (payload) => {
    setState((prev) => {
      const newCnt = {
        id: `cnt-${Date.now().toString().slice(-4)}`,
        organisationId: prev.workspace.id,
        name: payload.name,
        roles: payload.roles,
        email: payload.email,
        phone: payload.phone,
        businessId: payload.businessId,
        notes: payload.notes,
        status: "active" as const,
        createdAt: CURRENT_REFERENCE_DATE,
      };
      const audit = appendAudit({
        action: "contact.created",
        entityType: "contact",
        entityId: newCnt.id,
        summary: `Added contact "${newCnt.name}" (${newCnt.roles.join(", ")}).`,
      });
      return {
        ...prev,
        contacts: [newCnt, ...prev.contacts],
        auditEvents: [audit, ...prev.auditEvents],
      };
    });
    setToastBanner(`Saved contact: ${payload.name}`);
  };

  const handleCreateBill: React.ComponentProps<typeof ContactsAndBillsView>["onCreateBill"] = (
    payload,
  ) => {
    setState((prev) => {
      const newBill: SupplierBill = {
        id: `bill-${Date.now().toString().slice(-4)}`,
        organisationId: prev.workspace.id,
        billNumber: payload.billNumber,
        supplierId: payload.supplierId,
        billDate: payload.billDate,
        dueDate: payload.dueDate,
        amountKobo: payload.amountKobo,
        paidAmountKobo: 0,
        categoryId: payload.categoryId,
        reference: payload.reference,
        status: "open",
        notes: payload.notes,
        createdBy: activeMember.name,
        createdAt: new Date().toISOString(),
      };
      const audit = appendAudit({
        action: "bill.recorded",
        entityType: "bill",
        entityId: newBill.id,
        summary: `Recorded supplier bill ${newBill.billNumber} for ${formatNgn(newBill.amountKobo)}.`,
      });
      return {
        ...prev,
        bills: [newBill, ...prev.bills],
        auditEvents: [audit, ...prev.auditEvents],
      };
    });
    setToastBanner(`Supplier bill ${payload.billNumber} recorded.`);
  };

  const handleRecordBillPayment: React.ComponentProps<
    typeof ContactsAndBillsView
  >["onRecordBillPayment"] = ({ billId, amountKobo, trackingAccountId, reference }) => {
    setState((prev) => {
      const bill = prev.bills.find((b) => b.id === billId);
      if (!bill) return prev;
      const nextPaid = bill.paidAmountKobo + amountKobo;
      const isFull = nextPaid >= bill.amountKobo;

      const newTx: TransactionRecord = {
        id: `tx-bill-${Date.now().toString().slice(-4)}`,
        organisationId: prev.workspace.id,
        date: CURRENT_REFERENCE_DATE,
        description: `Supplier bill payment · ${bill.billNumber}`,
        type: "expense",
        status: "posted",
        amountKobo,
        direction: "outflow",
        categoryId: bill.categoryId,
        trackingAccountId,
        contactId: bill.supplierId,
        reference,
        source: "bill_payment",
        billId: bill.id,
        createdBy: activeMember.name,
        createdAt: new Date().toISOString(),
      };

      const audit = appendAudit({
        action: "bill.payment_recorded",
        entityType: "bill",
        entityId: bill.id,
        summary: `Recorded bookkeeping payment of ${formatNgn(amountKobo)} on supplier bill ${bill.billNumber}.`,
      });

      return {
        ...prev,
        bills: prev.bills.map((b) =>
          b.id === billId
            ? {
                ...b,
                paidAmountKobo: nextPaid,
                status: isFull ? "paid" : "partially_paid",
              }
            : b,
        ),
        transactions: [newTx, ...prev.transactions],
        auditEvents: [audit, ...prev.auditEvents],
      };
    });
    setToastBanner(`Recorded supplier bill payment (${formatNgn(amountKobo)}).`);
  };

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
          <span className="avatar">K</span>
          <span>
            <b>{state.workspace.displayName}</b>
            <small>{state.workspace.stateCity} · NGN</small>
          </span>
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
          ).map((item) => (
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
            <span>✓</span> Setup checklist (5/5)
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
            {/* Interactive Role Switcher for Testing RBAC */}
            <div className="role-switcher-wrap">
              <label htmlFor="active-role-select" className="role-switcher-label">
                Viewing as:
              </label>
              <select
                id="active-role-select"
                className="period-select"
                value={activeMember.id}
                onChange={(e) => {
                  const next = state.members.find((m) => m.id === e.target.value);
                  if (next) {
                    setActiveMemberId(next.id);
                    setToastBanner(
                      `Switched active session to ${next.name} (${ROLE_DESCRIPTIONS[next.role].label}).`,
                    );
                  }
                }}
              >
                {state.members
                  .filter((m) => m.status === "active")
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({ROLE_DESCRIPTIONS[m.role].label})
                    </option>
                  ))}
              </select>
            </div>

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
          </div>
        </header>

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
            onDismissObservation={(id) =>
              setState((prev) => ({
                ...prev,
                dismissedObservationIds: [...prev.dismissedObservationIds, id],
              }))
            }
            onMarkObservationReviewed={(id) =>
              setState((prev) => ({
                ...prev,
                reviewedObservationIds: {
                  ...prev.reviewedObservationIds,
                  [id]: CURRENT_REFERENCE_DATE,
                },
              }))
            }
            onRestoreObservations={() =>
              setState((prev) => ({ ...prev, dismissedObservationIds: [] }))
            }
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
          />
        )}

        {(activeTab === "cashflow" || activeTab === "reports") && (
          <CashFlowAndReportsView
            mode={activeTab}
            state={state}
            canExport={hasCapability(activeMember.role, "report:export")}
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
            onInviteMember={({ name, email, role }) => {
              setState((prev) => {
                const newMem = {
                  id: `mem-${Date.now().toString().slice(-4)}`,
                  userId: `usr-${Date.now().toString().slice(-4)}`,
                  name,
                  email,
                  organisationId: prev.workspace.id,
                  role,
                  status: "invited" as const,
                  active: false,
                  invitedAt: CURRENT_REFERENCE_DATE,
                };
                const audit = appendAudit({
                  action: "member.invited",
                  entityType: "member",
                  entityId: newMem.id,
                  summary: `Invited ${name} (${email}) with role ${role}.`,
                });
                return {
                  ...prev,
                  members: [...prev.members, newMem],
                  auditEvents: [audit, ...prev.auditEvents],
                };
              });
              setToastBanner(`Invitation sent to ${name} (${email}).`);
            }}
            onToggleMemberStatus={(memberId) => {
              setState((prev) => {
                const target = prev.members.find((m) => m.id === memberId);
                if (!target) return prev;
                const nextStatus = target.status === "active" ? "deactivated" : "active";
                const audit = appendAudit({
                  action: `member.${nextStatus}`,
                  entityType: "member",
                  entityId: memberId,
                  summary: `Changed ${target.name} membership status to ${nextStatus}.`,
                });
                return {
                  ...prev,
                  members: prev.members.map((m) =>
                    m.id === memberId
                      ? { ...m, status: nextStatus, active: nextStatus === "active" }
                      : m,
                  ),
                  auditEvents: [audit, ...prev.auditEvents],
                };
              });
            }}
            onChangeMemberRole={(memberId, role) => {
              setState((prev) => {
                const target = prev.members.find((m) => m.id === memberId);
                if (!target) return prev;
                const audit = appendAudit({
                  action: "member.role_changed",
                  entityType: "member",
                  entityId: memberId,
                  summary: `Changed ${target.name} role from ${target.role} to ${role}.`,
                });
                return {
                  ...prev,
                  members: prev.members.map((m) =>
                    m.id === memberId ? { ...m, role } : m,
                  ),
                  auditEvents: [audit, ...prev.auditEvents],
                };
              });
              setToastBanner("Member role updated.");
            }}
            onUpdateWorkspaceProfile={(payload) => {
              setState((prev) => {
                const audit = appendAudit({
                  action: "workspace.settings_updated",
                  entityType: "workspace",
                  entityId: prev.workspace.id,
                  summary: `Updated workspace profile (${payload.displayName}) & low cash threshold (${formatNgn(payload.lowCashThresholdKobo)}).`,
                });
                return {
                  ...prev,
                  workspace: {
                    ...prev.workspace,
                    ...payload,
                    updatedAt: new Date().toISOString(),
                  },
                  auditEvents: [audit, ...prev.auditEvents],
                };
              });
            }}
            onAddCategory={({ name, type }) => {
              setState((prev) => ({
                ...prev,
                categories: [
                  ...prev.categories,
                  {
                    id: `cat-${Date.now().toString().slice(-4)}`,
                    organisationId: prev.workspace.id,
                    name,
                    type,
                    archived: false,
                  },
                ],
              }));
              setToastBanner(`Category "${name}" added.`);
            }}
            onToggleArchiveCategory={(categoryId) => {
              setState((prev) => ({
                ...prev,
                categories: prev.categories.map((c) =>
                  c.id === categoryId ? { ...c, archived: !c.archived } : c,
                ),
              }));
            }}
            onAddTrackingAccount={({ name, kind, maskedRef, openingBalanceKobo }) => {
              setState((prev) => ({
                ...prev,
                trackingAccounts: [
                  ...prev.trackingAccounts,
                  {
                    id: `acc-${Date.now().toString().slice(-4)}`,
                    organisationId: prev.workspace.id,
                    name,
                    kind,
                    maskedRef,
                    openingBalanceKobo,
                    openingBalanceDate: CURRENT_REFERENCE_DATE,
                    archived: false,
                  },
                ],
              }));
              setToastBanner(`Tracking label "${name}" added.`);
            }}
            onRevokeOtherSessions={() => {
              setState((prev) => ({
                ...prev,
                sessions: prev.sessions.filter((s) => s.current),
              }));
              setToastBanner("Signed out of all other sessions.");
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
            onClick={() => handleNavigate(activeTab === "reports" ? "settings" : "reports")}
          >
            ☰<small>More</small>
          </button>
        </nav>
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
              <div className="attention-row">
                <span className="attention-icon amber">↗</span>
                <span>
                  <b>INV-024 (Adeola Foods) is 8 days overdue</b>
                  <small>Review and send reminder from Invoices</small>
                </span>
              </div>
              <div className="attention-row">
                <span className="attention-icon blue">◷</span>
                <span>
                  <b>Supplier bill BILL-018 (Midas Packaging) due tomorrow</b>
                  <small>Due 07 Nov 2026 · Bookkeeping reminder</small>
                </span>
              </div>
              <div className="attention-row">
                <span className="attention-icon green">✓</span>
                <span>
                  <b>CSV Import moniepoint-pos-october-week4.csv committed</b>
                  <small>1 row posted, 1 duplicate candidate skipped</small>
                </span>
              </div>
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
                <h2 id="onb-title">First-time setup checklist</h2>
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
                  ✓ <b>Step 1 — Account verified:</b> Signed in via verified email/phone OTP (Amina Okafor).
                </li>
                <li>
                  ✓ <b>Step 2 — Business profile:</b> {state.workspace.legalName} ({state.workspace.stateCity}).
                </li>
                <li>
                  ✓ <b>Step 3 — Financial defaults:</b> NGN (₦) base currency, Africa/Lagos timezone, Jan–Dec financial year.
                </li>
                <li>
                  ✓ <b>Step 4 — Non-custodial tracking labels:</b> GTBank ••2041, POS settlement, and Cash configured with opening recorded balances.
                </li>
                <li>
                  ✓ <b>Step 5 — Team & first records:</b> Bookkeeper & External Accountant invited; transactions and invoices recorded.
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
                onClick={() => {
                  setFeedbackText("");
                  setShowHelpModal(false);
                  setToastBanner("Thank you! Your pilot feedback has been recorded.");
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
