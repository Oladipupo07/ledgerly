"use client";

import React, { useState, useMemo } from "react";
import {
  WorkspaceState,
  TransactionRecord,
  TransactionType,
  ImportRowPreview,
  parseAndValidateCsvImport,
  formatDisplayDate,
  CURRENT_REFERENCE_DATE,
} from "@/lib/domain";
import { formatNgn, parseNairaToKobo } from "@/lib/money";
import { SAMPLE_CSV_TEMPLATE } from "@/lib/seed";

interface TransactionsViewProps {
  state: WorkspaceState;
  initialTypeFilter?: string;
  canWrite: boolean;
  canReverse: boolean;
  canImport: boolean;
  openModalSignal?: "new_tx" | "csv_import" | null;
  onClearModalSignal?: () => void;
  onCreateTransaction: (payload: {
    date: string;
    description: string;
    type: TransactionType;
    status: "draft" | "posted";
    amountKobo: number;
    direction: "inflow" | "outflow";
    categoryId: string;
    trackingAccountId: string;
    transferToAccountId?: string;
    contactId?: string;
    reference?: string;
    notes?: string;
    idempotencyKey: string;
  }) => void;
  onPostDraftTransaction: (txId: string) => void;
  onReverseTransaction: (txId: string, reason: string, replacementAmountKobo?: number) => void;
  onCommitCsvImport: (payload: {
    fileName: string;
    trackingAccountId: string;
    rows: ImportRowPreview[];
  }) => void;
}

export function TransactionsView({
  state,
  initialTypeFilter = "all",
  canWrite,
  canReverse,
  canImport,
  openModalSignal,
  onClearModalSignal,
  onCreateTransaction,
  onPostDraftTransaction,
  onReverseTransaction,
  onCommitCsvImport,
}: TransactionsViewProps) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>(initialTypeFilter);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [accountFilter, setAccountFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(openModalSignal === "new_tx");
  const [showImportModal, setShowImportModal] = useState(openModalSignal === "csv_import");
  const [selectedTx, setSelectedTx] = useState<TransactionRecord | null>(null);
  const [reversingTx, setReversingTx] = useState<TransactionRecord | null>(null);

  // Create form state
  const [txType, setTxType] = useState<TransactionType>("income");
  const [txDate, setTxDate] = useState(CURRENT_REFERENCE_DATE);
  const [txDesc, setTxDesc] = useState("");
  const [txAmountInput, setTxAmountInput] = useState("");
  const [txCategory, setTxCategory] = useState(state.categories[0]?.id ?? "");
  const [txAccount, setTxAccount] = useState(state.trackingAccounts[0]?.id ?? "");
  const [txTransferTo, setTxTransferTo] = useState(state.trackingAccounts[1]?.id ?? "");
  const [txContact, setTxContact] = useState("");
  const [txRef, setTxRef] = useState("");
  const [txNotes, setTxNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  // Reversal form state
  const [reversalReason, setReversalReason] = useState("");
  const [replacementAmountInput, setReplacementAmountInput] = useState("");
  const [reversalError, setReversalError] = useState<string | null>(null);

  // CSV Import Wizard state
  const [importStep, setImportStep] = useState<1 | 2 | 3>(1);
  const [csvFileName, setCsvFileName] = useState("gtbank-statement-nov2026.csv");
  const [csvText, setCsvText] = useState(SAMPLE_CSV_TEMPLATE);
  const [csvDateFormat, setCsvDateFormat] = useState<"YYYY-MM-DD" | "DD/MM/YYYY">("YYYY-MM-DD");
  const [csvDecimalSep, setCsvDecimalSep] = useState<"." | ",">(".");
  const [csvAccount, setCsvAccount] = useState(state.trackingAccounts[0]?.id ?? "");
  const [csvDefaultCategory, setCsvDefaultCategory] = useState(state.categories[0]?.id ?? "");
  const [previewRows, setPreviewRows] = useState<ImportRowPreview[]>([]);

  React.useEffect(() => {
    if (openModalSignal === "new_tx") {
      setShowCreateModal(true);
      onClearModalSignal?.();
    } else if (openModalSignal === "csv_import") {
      setShowImportModal(true);
      onClearModalSignal?.();
    }
  }, [openModalSignal, onClearModalSignal]);

  React.useEffect(() => {
    if (initialTypeFilter) setTypeFilter(initialTypeFilter);
  }, [initialTypeFilter]);

  const categoriesById = useMemo(
    () => new Map(state.categories.map((c) => [c.id, c.name])),
    [state.categories],
  );
  const accountsById = useMemo(
    () => new Map(state.trackingAccounts.map((a) => [a.id, a.name])),
    [state.trackingAccounts],
  );
  const contactsById = useMemo(
    () => new Map(state.contacts.map((c) => [c.id, c.name])),
    [state.contacts],
  );

  const filteredTransactions = useMemo(() => {
    return state.transactions
      .filter((tx) => {
        if (typeFilter !== "all" && tx.type !== typeFilter) return false;
        if (statusFilter !== "all" && tx.status !== statusFilter) return false;
        if (accountFilter !== "all" && tx.trackingAccountId !== accountFilter) return false;
        if (categoryFilter !== "all" && tx.categoryId !== categoryFilter) return false;
        if (search.trim()) {
          const q = search.toLowerCase();
          const contactName = (contactsById.get(tx.contactId ?? "") ?? "").toLowerCase();
          const matchDesc = tx.description.toLowerCase().includes(q);
          const matchRef = (tx.reference ?? "").toLowerCase().includes(q);
          const matchContact = contactName.includes(q);
          if (!matchDesc && !matchRef && !matchContact) return false;
        }
        return true;
      })
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [state.transactions, typeFilter, statusFilter, accountFilter, categoryFilter, search, contactsById]);

  const handleSubmitTransaction = (targetStatus: "draft" | "posted") => {
    setFormError(null);
    if (!txDesc.trim()) {
      setFormError("Description is required so your team understands this record.");
      return;
    }
    if (!txDate) {
      setFormError("Transaction date is required.");
      return;
    }
    let amountKobo = 0;
    try {
      amountKobo = parseNairaToKobo(txAmountInput);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Enter a valid NGN amount.");
      return;
    }

    if (txType === "transfer" && txAccount === txTransferTo) {
      setFormError("Source and destination tracking labels must be different for a transfer.");
      return;
    }

    const direction: "inflow" | "outflow" =
      txType === "income" || txType === "adjustment" ? "inflow" : "outflow";

    onCreateTransaction({
      date: txDate,
      description: txDesc.trim(),
      type: txType,
      status: targetStatus,
      amountKobo,
      direction,
      categoryId: txCategory,
      trackingAccountId: txAccount,
      transferToAccountId: txType === "transfer" ? txTransferTo : undefined,
      contactId: txContact || undefined,
      reference: txRef.trim() || undefined,
      notes: txNotes.trim() || undefined,
      idempotencyKey: `idem-${txDate}-${amountKobo}-${txDesc.trim().slice(0, 16)}`,
    });

    setTxDesc("");
    setTxAmountInput("");
    setTxRef("");
    setTxNotes("");
    setShowCreateModal(false);
  };

  const handleConfirmReversal = () => {
    if (!reversingTx) return;
    setReversalError(null);
    if (reversalReason.trim().length < 5) {
      setReversalError("Please provide a clear reason (at least 5 characters) for the audit trail.");
      return;
    }
    let replacementKobo: number | undefined;
    if (replacementAmountInput.trim()) {
      try {
        replacementKobo = parseNairaToKobo(replacementAmountInput);
      } catch (err) {
        setReversalError(err instanceof Error ? err.message : "Invalid replacement amount.");
        return;
      }
    }
    onReverseTransaction(reversingTx.id, reversalReason.trim(), replacementKobo);
    setReversingTx(null);
    setReversalReason("");
    setReplacementAmountInput("");
  };

  const handleGenerateCsvPreview = () => {
    const parsed = parseAndValidateCsvImport({
      csvText,
      dateFormat: csvDateFormat,
      decimalSeparator: csvDecimalSep,
      defaultCategoryId: csvDefaultCategory,
      trackingAccountId: csvAccount,
      existingTransactions: state.transactions,
    });
    setPreviewRows(parsed);
    setImportStep(2);
  };

  const handleToggleRowDecision = (rowNumber: number) => {
    setPreviewRows((prev) =>
      prev.map((r) => {
        if (r.rowNumber !== rowNumber || r.status === "error") return r;
        return {
          ...r,
          decision: r.decision === "include" ? "skip" : "include",
        };
      }),
    );
  };

  const handleCommitImport = () => {
    onCommitCsvImport({
      fileName: csvFileName || "uploaded-records.csv",
      trackingAccountId: csvAccount,
      rows: previewRows,
    });
    setImportStep(3);
  };

  return (
    <div className="page-wrap">
      <div className="heading-row">
        <div>
          <p className="eyebrow">TRANSACTIONS & IMPORT LEDGER</p>
          <h1>Transactions</h1>
          <p className="subheading">
            Every posted record is append-only. Mistakes are corrected via traceable reversal.
          </p>
        </div>
        <div className="heading-actions">
          {canImport && (
            <button
              type="button"
              className="secondary-btn"
              onClick={() => {
                setImportStep(1);
                setShowImportModal(true);
              }}
            >
              ↑ Import CSV
            </button>
          )}
          {canWrite && (
            <button
              type="button"
              className="primary"
              onClick={() => setShowCreateModal(true)}
            >
              ＋ <span>Add transaction</span>
            </button>
          )}
        </div>
      </div>

      {/* Filters Toolbar */}
      <section className="filter-bar" aria-label="Transaction filters">
        <input
          type="search"
          className="search-input"
          placeholder="Search description, reference, or contact…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="period-select"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          aria-label="Filter by type"
        >
          <option value="all">All types</option>
          <option value="income">Income</option>
          <option value="expense">Expense</option>
          <option value="transfer">Transfer</option>
          <option value="refund">Refund</option>
          <option value="adjustment">Adjustment</option>
        </select>

        <select
          className="period-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by status"
        >
          <option value="all">All statuses</option>
          <option value="posted">Posted</option>
          <option value="draft">Draft</option>
          <option value="reversed">Reversed</option>
        </select>

        <select
          className="period-select"
          value={accountFilter}
          onChange={(e) => setAccountFilter(e.target.value)}
          aria-label="Filter by tracking label"
        >
          <option value="all">All tracking labels</option>
          {state.trackingAccounts.map((acc) => (
            <option key={acc.id} value={acc.id}>
              {acc.name}
            </option>
          ))}
        </select>

        <select
          className="period-select"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          aria-label="Filter by category"
        >
          <option value="all">All categories</option>
          {state.categories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.name}
            </option>
          ))}
        </select>

        {(search ||
          typeFilter !== "all" ||
          statusFilter !== "all" ||
          accountFilter !== "all" ||
          categoryFilter !== "all") && (
          <button
            type="button"
            className="text-btn"
            onClick={() => {
              setSearch("");
              setTypeFilter("all");
              setStatusFilter("all");
              setAccountFilter("all");
              setCategoryFilter("all");
            }}
          >
            Clear filters
          </button>
        )}
      </section>

      {/* Transactions Table */}
      <section className="panel transactions">
        <div className="panel-head">
          <div>
            <h2>Showing {filteredTransactions.length} record(s)</h2>
            <p>Click any row to inspect provenance, audit history, or initiate a safe correction</p>
          </div>
        </div>

        {filteredTransactions.length === 0 ? (
          <div className="empty-card">
            <h3>No transactions match these filters</h3>
            <p>Clear your filters or add a new record to continue.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description & Reference</th>
                  <th>Contact</th>
                  <th>Category</th>
                  <th>Tracking Label</th>
                  <th>Source / Status</th>
                  <th>Amount (NGN)</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredTransactions.map((tx) => (
                  <tr
                    key={tx.id}
                    className={tx.status === "reversed" ? "row-reversed" : ""}
                  >
                    <td>{formatDisplayDate(tx.date)}</td>
                    <td className="description">
                      <button
                        type="button"
                        className="row-title-btn"
                        onClick={() => setSelectedTx(tx)}
                      >
                        {tx.description}
                      </button>
                      {tx.reference && <span className="sub-meta">Ref: {tx.reference}</span>}
                      {tx.reversalReason && (
                        <span className="sub-meta warning-text">
                          Reason: {tx.reversalReason}
                        </span>
                      )}
                    </td>
                    <td>{contactsById.get(tx.contactId ?? "") ?? "—"}</td>
                    <td>{categoriesById.get(tx.categoryId) ?? "—"}</td>
                    <td>
                      {accountsById.get(tx.trackingAccountId) ?? "—"}
                      {tx.transferToAccountId &&
                        ` → ${accountsById.get(tx.transferToAccountId) ?? ""}`}
                    </td>
                    <td>
                      <span
                        className={`tag ${
                          tx.status === "posted"
                            ? tx.direction === "inflow"
                              ? "income"
                              : "expense"
                            : tx.status === "draft"
                              ? "amber"
                              : "coral"
                        }`}
                      >
                        {tx.status.toUpperCase()} · {tx.type}
                      </span>
                      <span className="sub-meta">{tx.source.replace("_", " ")}</span>
                    </td>
                    <td className={tx.direction === "inflow" ? "positive" : "negative"}>
                      {tx.direction === "inflow" ? "+" : "−"}
                      {formatNgn(tx.amountKobo)}
                    </td>
                    <td>
                      <div className="table-actions">
                        <button
                          type="button"
                          className="subtle-btn"
                          onClick={() => setSelectedTx(tx)}
                        >
                          Details
                        </button>
                        {tx.status === "draft" && canWrite && (
                          <button
                            type="button"
                            className="link-btn"
                            onClick={() => onPostDraftTransaction(tx.id)}
                          >
                            Post
                          </button>
                        )}
                        {tx.status === "posted" &&
                          !tx.reversesTransactionId &&
                          canReverse && (
                            <button
                              type="button"
                              className="subtle-btn danger-text"
                              onClick={() => {
                                setReversingTx(tx);
                                setReversalReason("");
                                setReplacementAmountInput("");
                                setReversalError(null);
                              }}
                            >
                              Correct/Reverse
                            </button>
                          )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Import Batch Provenance Panel */}
      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panel-head">
          <div>
            <h2>CSV Import Batches ({state.importBatches.length})</h2>
            <p>Traceable history of uploaded bank and POS statements</p>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Batch ID</th>
                <th>File Name</th>
                <th>Tracking Label</th>
                <th>Uploaded By</th>
                <th>Committed</th>
                <th>Skipped / Duplicates</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {state.importBatches.map((batch) => (
                <tr key={batch.id}>
                  <td>
                    <code>{batch.id}</code>
                  </td>
                  <td className="description">{batch.fileName}</td>
                  <td>{accountsById.get(batch.trackingAccountId) ?? "—"}</td>
                  <td>{batch.uploadedBy}</td>
                  <td>{batch.committedCount} row(s)</td>
                  <td>{batch.skippedCount} row(s)</td>
                  <td>
                    <span className="tag income">{batch.status.toUpperCase()}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Create / Draft / Post Modal */}
      {showCreateModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="new-tx-title">
          <div className="modal-card">
            <div className="modal-header">
              <div>
                <span className="brief-label">RECORD BUSINESS MONEY</span>
                <h2 id="new-tx-title">Add transaction</h2>
              </div>
              <button
                type="button"
                className="close-btn"
                onClick={() => setShowCreateModal(false)}
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              {formError && (
                <div className="error-banner" role="alert">
                  {formError}
                </div>
              )}

              <div className="form-grid">
                <label className="form-field">
                  <span>Transaction Type *</span>
                  <select
                    value={txType}
                    onChange={(e) => setTxType(e.target.value as TransactionType)}
                  >
                    <option value="income">Income (Inflow)</option>
                    <option value="expense">Expense (Outflow)</option>
                    <option value="transfer">Transfer between tracking labels</option>
                    <option value="refund">Refund (Outflow)</option>
                    <option value="adjustment">Positive Adjustment (Inflow)</option>
                  </select>
                </label>

                <label className="form-field">
                  <span>Date (Africa/Lagos) *</span>
                  <input
                    type="date"
                    value={txDate}
                    onChange={(e) => setTxDate(e.target.value)}
                  />
                </label>

                <label className="form-field full-span">
                  <span>Amount in NGN (₦) *</span>
                  <input
                    type="text"
                    placeholder="e.g. 45000.00"
                    value={txAmountInput}
                    onChange={(e) => setTxAmountInput(e.target.value)}
                  />
                  <small>Stored in exact integer kobo. Do not include minus signs.</small>
                </label>

                <label className="form-field full-span">
                  <span>Description *</span>
                  <input
                    type="text"
                    placeholder="e.g. Bespoke corporate tailoring deposit"
                    value={txDesc}
                    onChange={(e) => setTxDesc(e.target.value)}
                  />
                </label>

                <label className="form-field">
                  <span>Category *</span>
                  <select
                    value={txCategory}
                    onChange={(e) => setTxCategory(e.target.value)}
                  >
                    {state.categories
                      .filter((c) => !c.archived)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.type})
                        </option>
                      ))}
                  </select>
                </label>

                <label className="form-field">
                  <span>{txType === "transfer" ? "From Tracking Label *" : "Tracking Label *"}</span>
                  <select
                    value={txAccount}
                    onChange={(e) => setTxAccount(e.target.value)}
                  >
                    {state.trackingAccounts
                      .filter((a) => !a.archived)
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                  </select>
                </label>

                {txType === "transfer" && (
                  <label className="form-field full-span">
                    <span>To Tracking Label (Internal bookkeeping transfer) *</span>
                    <select
                      value={txTransferTo}
                      onChange={(e) => setTxTransferTo(e.target.value)}
                    >
                      {state.trackingAccounts
                        .filter((a) => !a.archived)
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                    </select>
                  </label>
                )}

                <label className="form-field">
                  <span>Customer / Supplier (Optional)</span>
                  <select
                    value={txContact}
                    onChange={(e) => setTxContact(e.target.value)}
                  >
                    <option value="">— None —</option>
                    {state.contacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.roles.join("/")})
                      </option>
                    ))}
                  </select>
                </label>

                <label className="form-field">
                  <span>Payment Reference (Optional)</span>
                  <input
                    type="text"
                    placeholder="e.g. NIP-GTB-99412 or POS-1102"
                    value={txRef}
                    onChange={(e) => setTxRef(e.target.value)}
                  />
                </label>

                <label className="form-field full-span">
                  <span>Notes (Optional)</span>
                  <input
                    type="text"
                    placeholder="Optional internal context for your bookkeeper or accountant"
                    value={txNotes}
                    onChange={(e) => setTxNotes(e.target.value)}
                  />
                </label>
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="secondary-btn"
                onClick={() => handleSubmitTransaction("draft")}
              >
                Save as draft
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => handleSubmitTransaction("posted")}
              >
                Confirm & post record
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transaction Detail Modal */}
      {selectedTx && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="tx-detail-title">
          <div className="modal-card">
            <div className="modal-header">
              <div>
                <span className="brief-label">RECORD PROVENANCE & DETAILS</span>
                <h2 id="tx-detail-title">{selectedTx.description}</h2>
              </div>
              <button
                type="button"
                className="close-btn"
                onClick={() => setSelectedTx(null)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="evidence-summary-box">
                <div>
                  <small>Amount (NGN)</small>
                  <strong className={selectedTx.direction === "inflow" ? "positive" : "negative"}>
                    {selectedTx.direction === "inflow" ? "+" : "−"}
                    {formatNgn(selectedTx.amountKobo)}
                  </strong>
                </div>
                <div>
                  <small>Status</small>
                  <b>{selectedTx.status.toUpperCase()}</b>
                </div>
                <div>
                  <small>Date</small>
                  <b>{formatDisplayDate(selectedTx.date)}</b>
                </div>
              </div>

              <div className="detail-kv-grid">
                <div>
                  <small>Record ID</small>
                  <p><code>{selectedTx.id}</code></p>
                </div>
                <div>
                  <small>Tracking Label</small>
                  <p>{accountsById.get(selectedTx.trackingAccountId) ?? "—"}</p>
                </div>
                <div>
                  <small>Category</small>
                  <p>{categoriesById.get(selectedTx.categoryId) ?? "—"}</p>
                </div>
                <div>
                  <small>Contact</small>
                  <p>{contactsById.get(selectedTx.contactId ?? "") ?? "None"}</p>
                </div>
                <div>
                  <small>Payment Reference</small>
                  <p>{selectedTx.reference ?? "None"}</p>
                </div>
                <div>
                  <small>Source</small>
                  <p>{selectedTx.source}</p>
                </div>
                <div>
                  <small>Created By</small>
                  <p>{selectedTx.createdBy} ({selectedTx.createdAt.slice(0, 16).replace("T", " ")})</p>
                </div>
                {selectedTx.attachmentName && (
                  <div>
                    <small>Evidence Attachment</small>
                    <p>📎 {selectedTx.attachmentName}</p>
                  </div>
                )}
              </div>

              {selectedTx.reversalReason && (
                <div className="warning-note">
                  <b>Reversal / Correction Reason:</b> {selectedTx.reversalReason}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="secondary-btn"
                onClick={() => setSelectedTx(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Safe Reversal / Correction Modal */}
      {reversingTx && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="rev-modal-title">
          <div className="modal-card">
            <div className="modal-header">
              <div>
                <span className="brief-label">SAFE FINANCIAL CORRECTION</span>
                <h2 id="rev-modal-title">Reverse or replace posted entry</h2>
              </div>
              <button
                type="button"
                className="close-btn"
                onClick={() => setReversingTx(null)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p className="warning-note">
                Posted records are never overwritten or deleted. Confirming below marks{" "}
                <b>{reversingTx.description}</b> ({formatNgn(reversingTx.amountKobo)}) as reversed,
                creates an offsetting reversal entry, and logs the actor & reason in the audit history.
              </p>

              {reversalError && (
                <div className="error-banner" role="alert">
                  {reversalError}
                </div>
              )}

              <div className="form-grid">
                <label className="form-field full-span">
                  <span>Reason for correction / reversal *</span>
                  <input
                    type="text"
                    placeholder="e.g. Entered wrong POS amount from terminal slip"
                    value={reversalReason}
                    onChange={(e) => setReversalReason(e.target.value)}
                  />
                </label>

                <label className="form-field full-span">
                  <span>Optional Replacement Amount in NGN (leave blank to reverse only)</span>
                  <input
                    type="text"
                    placeholder="e.g. 42500.00"
                    value={replacementAmountInput}
                    onChange={(e) => setReplacementAmountInput(e.target.value)}
                  />
                  <small>
                    If entered, Ledgerly will automatically post the corrected replacement entry linked to this reversal.
                  </small>
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="secondary-btn"
                onClick={() => setReversingTx(null)}
              >
                Cancel (Keep original)
              </button>
              <button
                type="button"
                className="primary danger-bg"
                onClick={handleConfirmReversal}
              >
                Confirm reversal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4-Step CSV Import Wizard Modal */}
      {showImportModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="csv-wizard-title">
          <div className="modal-card wide-modal">
            <div className="modal-header">
              <div>
                <span className="brief-label">CSV IMPORT WIZARD · STEP {importStep} OF 3</span>
                <h2 id="csv-wizard-title">
                  {importStep === 1 && "1. Upload or paste CSV & set conventions"}
                  {importStep === 2 && "2. Preview parsed rows & resolve duplicates"}
                  {importStep === 3 && "3. Import batch committed"}
                </h2>
              </div>
              <button
                type="button"
                className="close-btn"
                onClick={() => setShowImportModal(false)}
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              {importStep === 1 && (
                <div className="form-grid">
                  <label className="form-field">
                    <span>Source File Name</span>
                    <input
                      type="text"
                      value={csvFileName}
                      onChange={(e) => setCsvFileName(e.target.value)}
                    />
                  </label>

                  <label className="form-field">
                    <span>Target Tracking Label *</span>
                    <select
                      value={csvAccount}
                      onChange={(e) => setCsvAccount(e.target.value)}
                    >
                      {state.trackingAccounts
                        .filter((a) => !a.archived)
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                    </select>
                  </label>

                  <label className="form-field">
                    <span>Date Convention</span>
                    <select
                      value={csvDateFormat}
                      onChange={(e) =>
                        setCsvDateFormat(e.target.value as "YYYY-MM-DD" | "DD/MM/YYYY")
                      }
                    >
                      <option value="YYYY-MM-DD">YYYY-MM-DD (e.g. 2026-11-05)</option>
                      <option value="DD/MM/YYYY">DD/MM/YYYY (e.g. 05/11/2026)</option>
                    </select>
                  </label>

                  <label className="form-field">
                    <span>Decimal Separator</span>
                    <select
                      value={csvDecimalSep}
                      onChange={(e) => setCsvDecimalSep(e.target.value as "." | ",")}
                    >
                      <option value=".">Period (e.g. 250,000.00)</option>
                      <option value=",">Comma (e.g. 250.000,00)</option>
                    </select>
                  </label>

                  <label className="form-field">
                    <span>Default Category for Imported Rows</span>
                    <select
                      value={csvDefaultCategory}
                      onChange={(e) => setCsvDefaultCategory(e.target.value)}
                    >
                      {state.categories
                        .filter((c) => !c.archived)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  </label>

                  <label className="form-field full-span">
                    <span>
                      CSV Content (Columns: <code>Date,Description,Amount,Reference,Type</code>)
                    </span>
                    <textarea
                      rows={7}
                      value={csvText}
                      onChange={(e) => setCsvText(e.target.value)}
                      className="code-textarea"
                    />
                    <small>
                      Notice row 2 is an intentional duplicate of existing transaction{" "}
                      <code>NIP-GTB-99412</code> and row 5 has an invalid date so you can test validation & deduplication.
                    </small>
                  </label>
                </div>
              )}

              {importStep === 2 && (
                <div>
                  <div className="evidence-summary-box">
                    <div>
                      <small>Total Rows Parsed</small>
                      <b>{previewRows.length}</b>
                    </div>
                    <div>
                      <small>Ready to Include</small>
                      <b className="positive">
                        {previewRows.filter((r) => r.decision === "include").length}
                      </b>
                    </div>
                    <div>
                      <small>Duplicates Flagged</small>
                      <b style={{ color: "var(--amber)" }}>
                        {previewRows.filter((r) => r.status === "duplicate_candidate").length}
                      </b>
                    </div>
                    <div>
                      <small>Malformed Rows</small>
                      <b style={{ color: "var(--red)" }}>
                        {previewRows.filter((r) => r.status === "error").length}
                      </b>
                    </div>
                  </div>

                  <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
                    No row is silently dropped. Review flagged duplicates or errors below and choose whether to <b>Include</b> or <b>Skip</b> each valid/duplicate row.
                  </p>

                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Row</th>
                          <th>Date</th>
                          <th>Description & Ref</th>
                          <th>Amount</th>
                          <th>Validation / Duplicate Check</th>
                          <th>Decision</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((row) => (
                          <tr key={row.rowNumber}>
                            <td>#{row.rowNumber}</td>
                            <td>{row.parsedDate ? formatDisplayDate(row.parsedDate) : row.rawDate}</td>
                            <td className="description">
                              {row.rawDescription}
                              {row.reference && <span className="sub-meta">Ref: {row.reference}</span>}
                            </td>
                            <td>
                              {row.amountKobo
                                ? `${row.direction === "inflow" ? "+" : "−"}${formatNgn(row.amountKobo)}`
                                : row.rawAmount}
                            </td>
                            <td>
                              {row.status === "valid" && (
                                <span className="tag income">✓ Valid</span>
                              )}
                              {row.status === "duplicate_candidate" && (
                                <div>
                                  <span className="tag amber">⚠ Duplicate candidate</span>
                                  <span className="sub-meta">{row.issueMessage}</span>
                                </div>
                              )}
                              {row.status === "error" && (
                                <div>
                                  <span className="tag coral">✕ Error</span>
                                  <span className="sub-meta">{row.issueMessage}</span>
                                </div>
                              )}
                            </td>
                            <td>
                              {row.status === "error" ? (
                                <span className="sub-meta">Skipped (Fix in CSV)</span>
                              ) : (
                                <button
                                  type="button"
                                  className={
                                    row.decision === "include"
                                      ? "pill-toggle include"
                                      : "pill-toggle skip"
                                  }
                                  onClick={() => handleToggleRowDecision(row.rowNumber)}
                                >
                                  {row.decision === "include" ? "✓ Include" : "Skip row"}
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {importStep === 3 && (
                <div className="empty-card">
                  <h3>✓ Import committed with full provenance</h3>
                  <p>
                    <b>{previewRows.filter((r) => r.decision === "include").length}</b> transaction(s)
                    were posted to <b>{accountsById.get(csvAccount)}</b> and linked to batch{" "}
                    <b>{csvFileName}</b>.
                  </p>
                </div>
              )}
            </div>

            <div className="modal-footer">
              {importStep === 1 && (
                <>
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => setShowImportModal(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="primary"
                    onClick={handleGenerateCsvPreview}
                  >
                    Preview & validate rows →
                  </button>
                </>
              )}
              {importStep === 2 && (
                <>
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => setImportStep(1)}
                  >
                    ← Back to CSV editor
                  </button>
                  <button
                    type="button"
                    className="primary"
                    disabled={previewRows.filter((r) => r.decision === "include").length === 0}
                    onClick={handleCommitImport}
                  >
                    Commit {previewRows.filter((r) => r.decision === "include").length} included row(s)
                  </button>
                </>
              )}
              {importStep === 3 && (
                <button
                  type="button"
                  className="primary"
                  onClick={() => setShowImportModal(false)}
                >
                  Done
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

