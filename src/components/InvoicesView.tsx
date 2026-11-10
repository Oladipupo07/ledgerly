"use client";

import React, { useState, useMemo, useRef } from "react";
import {
  WorkspaceState,
  InvoiceLine,
  InvoiceLifecycleState,
  computeInvoiceTotals,
  formatDisplayDate,
  CURRENT_REFERENCE_DATE,
} from "@/lib/domain";
import { formatNgn, parseNairaToKobo } from "@/lib/money";

interface InvoicesViewProps {
  state: WorkspaceState;
  canCreateSend: boolean;
  canRecordReceipt: boolean;
  onCreateInvoice: (payload: {
    invoiceNumber: string;
    customerId: string;
    issueDate: string;
    dueDate: string;
    status: "draft" | "shared";
    lines: InvoiceLine[];
    discountKobo: number;
    taxLabel: string;
    taxRatePercent: number;
    terms: string;
    paymentInstructions: string;
    notes?: string;
  }) => void;
  onUpdateInvoiceStatus: (invoiceId: string, status: InvoiceLifecycleState) => void;
  onRecordReceipt: (payload: {
    invoiceId: string;
    date: string;
    amountKobo: number;
    methodLabel: string;
    reference: string;
    trackingAccountId: string;
  }) => void;
  onSendReminder: (invoiceId: string) => void;
}

export function InvoicesView({
  state,
  canCreateSend,
  canRecordReceipt,
  onCreateInvoice,
  onUpdateInvoiceStatus,
  onRecordReceipt,
  onSendReminder,
}: InvoicesViewProps) {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [customerFilter, setCustomerFilter] = useState<string>("all");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [receiptInvoiceId, setReceiptInvoiceId] = useState<string | null>(null);
  const [reminderInvoiceId, setReminderInvoiceId] = useState<string | null>(null);

  // Create Invoice Form State
  const nextSuggestedNumber = `INV-0${state.invoices.length + 24}`;
  const [invNumber, setInvNumber] = useState(nextSuggestedNumber);
  const [invCustomer, setInvCustomer] = useState(
    state.contacts.find((c) => c.roles.includes("customer"))?.id ?? "",
  );
  const [invIssueDate, setInvIssueDate] = useState(CURRENT_REFERENCE_DATE);
  const [invDueDate, setInvDueDate] = useState(() => {
    const date = new Date(`${CURRENT_REFERENCE_DATE}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + 14);
    return date.toISOString().slice(0, 10);
  });
  const [invLines, setInvLines] = useState<
    Array<{ id: string; description: string; quantity: string; unitPriceNaira: string }>
  >([
    {
      id: "line-1",
      description: "",
      quantity: "1",
      unitPriceNaira: "",
    },
  ]);
  const [invDiscountInput, setInvDiscountInput] = useState("0");
  const [invTaxLabel, setInvTaxLabel] = useState("");
  const [invTaxRate, setInvTaxRate] = useState("0");
  const [invTerms, setInvTerms] = useState("");
  const [invPaymentInstr, setInvPaymentInstr] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  // Receipt Form State
  const [rcpDate, setRcpDate] = useState(CURRENT_REFERENCE_DATE);
  const [rcpAmountInput, setRcpAmountInput] = useState("");
  const [rcpMethod, setRcpMethod] = useState("Bank Transfer (NIP)");
  const [rcpRef, setRcpRef] = useState("");
  const [rcpAccount, setRcpAccount] = useState(state.trackingAccounts[0]?.id ?? "");
  const [rcpConfirmed, setRcpConfirmed] = useState(false);
  const [rcpError, setRcpError] = useState<string | null>(null);
  const [reminderError, setReminderError] = useState<string | null>(null);
  const reminderTextRef = useRef<HTMLTextAreaElement>(null);

  const contactsById = useMemo(
    () => new Map(state.contacts.map((c) => [c.id, c])),
    [state.contacts],
  );

  const evaluatedInvoices = useMemo(() => {
    return state.invoices.map((invoice) => ({
      invoice,
      calc: computeInvoiceTotals(invoice),
    }));
  }, [state.invoices]);

  const filteredInvoices = useMemo(() => {
    return evaluatedInvoices.filter(({ invoice, calc }) => {
      if (statusFilter !== "all" && calc.effectiveState !== statusFilter) return false;
      if (customerFilter !== "all" && invoice.customerId !== customerFilter) return false;
      return true;
    });
  }, [evaluatedInvoices, statusFilter, customerFilter]);

  const selectedInvoiceObj = useMemo(
    () => evaluatedInvoices.find((x) => x.invoice.id === selectedInvoiceId) ?? null,
    [evaluatedInvoices, selectedInvoiceId],
  );

  const receiptInvoiceObj = useMemo(
    () => evaluatedInvoices.find((x) => x.invoice.id === receiptInvoiceId) ?? null,
    [evaluatedInvoices, receiptInvoiceId],
  );

  const reminderInvoiceObj = useMemo(
    () => evaluatedInvoices.find((x) => x.invoice.id === reminderInvoiceId) ?? null,
    [evaluatedInvoices, reminderInvoiceId],
  );

  const handleCreateSubmit = (targetStatus: "draft" | "shared") => {
    setCreateError(null);
    if (!invNumber.trim()) {
      setCreateError("Invoice number is required.");
      return;
    }
    if (
      state.invoices.some(
        (i) => i.invoiceNumber.toLowerCase() === invNumber.trim().toLowerCase(),
      )
    ) {
      setCreateError(`Invoice number "${invNumber}" already exists in this workspace.`);
      return;
    }
    if (!invCustomer) {
      setCreateError("Please select a customer.");
      return;
    }
    if (invDueDate < invIssueDate) {
      setCreateError("Due date cannot be earlier than the issue date.");
      return;
    }

    const parsedLines: InvoiceLine[] = [];
    for (const ln of invLines) {
      if (!ln.description.trim()) {
        setCreateError("Every invoice line must have a description.");
        return;
      }
      const qty = Number(ln.quantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        setCreateError("Line quantity must be greater than zero.");
        return;
      }
      try {
        const unitPriceKobo = parseNairaToKobo(ln.unitPriceNaira);
        parsedLines.push({
          id: ln.id,
          description: ln.description.trim(),
          quantity: qty,
          unitPriceKobo,
        });
      } catch (err) {
        setCreateError(
          err instanceof Error ? err.message : "Enter valid NGN unit prices for all lines.",
        );
        return;
      }
    }

    let discountKobo = 0;
    if (invDiscountInput.trim() && invDiscountInput.trim() !== "0") {
      try {
        discountKobo = parseNairaToKobo(invDiscountInput);
      } catch {
        setCreateError("Enter a valid NGN discount amount or 0.");
        return;
      }
    }

    const taxRate = Number(invTaxRate) || 0;

    onCreateInvoice({
      invoiceNumber: invNumber.trim().toUpperCase(),
      customerId: invCustomer,
      issueDate: invIssueDate,
      dueDate: invDueDate,
      status: targetStatus,
      lines: parsedLines,
      discountKobo,
      taxLabel: invTaxLabel.trim() || "Tax (User-configured)",
      taxRatePercent: Math.max(0, Math.min(100, taxRate)),
      terms: invTerms.trim(),
      paymentInstructions: invPaymentInstr.trim(),
    });

    setShowCreateModal(false);
  };

  const handleRecordReceiptSubmit = () => {
    if (!receiptInvoiceObj) return;
    setRcpError(null);

    if (!rcpConfirmed) {
      setRcpError(
        "Please confirm that you have verified this payment was received before recording the receipt.",
      );
      return;
    }
    if (!rcpRef.trim()) {
      setRcpError("Enter a payment reference (e.g. NIP transfer ref or receipt slip number).");
      return;
    }

    let amountKobo = 0;
    try {
      amountKobo = parseNairaToKobo(rcpAmountInput);
    } catch (err) {
      setRcpError(err instanceof Error ? err.message : "Enter a valid NGN receipt amount.");
      return;
    }

    if (amountKobo > receiptInvoiceObj.calc.outstandingKobo) {
      setRcpError(
        `Receipt amount (${formatNgn(amountKobo)}) cannot exceed the outstanding invoice balance (${formatNgn(
          receiptInvoiceObj.calc.outstandingKobo,
        )}).`,
      );
      return;
    }

    onRecordReceipt({
      invoiceId: receiptInvoiceObj.invoice.id,
      date: rcpDate,
      amountKobo,
      methodLabel: rcpMethod,
      reference: rcpRef.trim(),
      trackingAccountId: rcpAccount,
    });

    setReceiptInvoiceId(null);
    setRcpAmountInput("");
    setRcpRef("");
    setRcpConfirmed(false);
  };

  return (
    <div className="page-wrap">
      <div className="heading-row">
        <div>
          <p className="eyebrow">INVOICES, RECEIPTS & RECEIVABLES</p>
          <h1>Invoices</h1>
          <p className="subheading">
            Issue invoices with your payment instructions, track partial or full receipts, and follow up overdue balances.
          </p>
        </div>
        <div className="heading-actions">
          {canCreateSend && (
            <button
              type="button"
              className="primary"
              onClick={() => {
                setInvNumber(`INV-0${state.invoices.length + 24}`);
                setCreateError(null);
                setShowCreateModal(true);
              }}
            >
              ＋ <span>Create invoice</span>
            </button>
          )}
        </div>
      </div>

      <div className="coverage" role="note">
        <span>ℹ</span>
        <span>
          <b>Regulatory notice:</b> Ledgerly generates standard commercial invoices for your business records. They are not fiscally validated NRS e-invoices, and Ledgerly does not initiate or custody payments.
        </span>
      </div>

      {/* Filters */}
      <section className="filter-bar" aria-label="Invoice filters">
        <select
          className="period-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">All lifecycle states</option>
          <option value="overdue">Overdue</option>
          <option value="partially_paid">Partially paid</option>
          <option value="shared">Sent / Open</option>
          <option value="paid">Paid</option>
          <option value="draft">Draft</option>
          <option value="disputed">Disputed</option>
          <option value="cancelled">Cancelled</option>
        </select>

        <select
          className="period-select"
          value={customerFilter}
          onChange={(e) => setCustomerFilter(e.target.value)}
        >
          <option value="all">All customers</option>
          {state.contacts
            .filter((c) => c.roles.includes("customer"))
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
      </section>

      {/* Invoices Table */}
      <section className="panel transactions">
        <div className="panel-head">
          <div>
            <h2>Invoices ({filteredInvoices.length})</h2>
            <p>Click an invoice number to preview, share, or inspect receipt history</p>
          </div>
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Customer</th>
                <th>Issue Date</th>
                <th>Due Date</th>
                <th>Status</th>
                <th>Total (NGN)</th>
                <th>Outstanding (NGN)</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredInvoices.map(({ invoice, calc }) => {
                const customer = contactsById.get(invoice.customerId);
                return (
                  <tr key={invoice.id}>
                    <td className="description">
                      <button
                        type="button"
                        className="row-title-btn"
                        onClick={() => setSelectedInvoiceId(invoice.id)}
                      >
                        {invoice.invoiceNumber}
                      </button>
                    </td>
                    <td>{customer?.name ?? "Unknown Customer"}</td>
                    <td>{formatDisplayDate(invoice.issueDate)}</td>
                    <td>
                      {formatDisplayDate(invoice.dueDate)}
                      {calc.isOverdue && (
                        <span className="sub-meta warning-text">
                          {calc.daysOverdue} days overdue
                        </span>
                      )}
                    </td>
                    <td>
                      <span
                        className={`tag ${
                          calc.effectiveState === "paid"
                            ? "income"
                            : calc.effectiveState === "overdue"
                              ? "coral"
                              : calc.effectiveState === "partially_paid"
                                ? "amber"
                                : "expense"
                        }`}
                      >
                        {calc.effectiveState.replace("_", " ").toUpperCase()}
                      </span>
                    </td>
                    <td>{formatNgn(calc.totalKobo)}</td>
                    <td className={calc.outstandingKobo > 0 ? "negative" : "positive"}>
                      {formatNgn(calc.outstandingKobo)}
                    </td>
                    <td>
                      <div className="table-actions">
                        <button
                          type="button"
                          className="subtle-btn"
                          onClick={() => setSelectedInvoiceId(invoice.id)}
                        >
                          Preview
                        </button>
                        {invoice.status === "draft" && canCreateSend && (
                          <button
                            type="button"
                            className="link-btn"
                            onClick={() => onUpdateInvoiceStatus(invoice.id, "shared")}
                          >
                            Mark shared
                          </button>
                        )}
                        {calc.outstandingKobo > 0 &&
                          invoice.status !== "draft" &&
                          invoice.status !== "cancelled" &&
                          canRecordReceipt && (
                            <button
                              type="button"
                              className="link-btn"
                              onClick={() => {
                                setReceiptInvoiceId(invoice.id);
                                setRcpAmountInput(
                                  (calc.outstandingKobo / 100).toFixed(2),
                                );
                                setRcpRef("");
                                setRcpConfirmed(false);
                                setRcpError(null);
                              }}
                            >
                              Record receipt
                            </button>
                          )}
                        {calc.isOverdue && canCreateSend && (
                          <button
                            type="button"
                            className="subtle-btn"
                            onClick={() => setReminderInvoiceId(invoice.id)}
                          >
                            Reminder
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Create Invoice Modal */}
      {showCreateModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="create-inv-title">
          <div className="modal-card wide-modal">
            <div className="modal-header">
              <div>
                <span className="brief-label">COMMERCIAL INVOICE · ORDINARY LEDGERLY RECORD</span>
                <h2 id="create-inv-title">Create invoice</h2>
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
              {createError && (
                <div className="error-banner" role="alert">
                  {createError}
                </div>
              )}

              <div className="form-grid">
                <label className="form-field">
                  <span>Invoice Number (Unique) *</span>
                  <input
                    type="text"
                    value={invNumber}
                    onChange={(e) => setInvNumber(e.target.value)}
                  />
                </label>

                <label className="form-field">
                  <span>Customer *</span>
                  <select
                    value={invCustomer}
                    onChange={(e) => setInvCustomer(e.target.value)}
                  >
                    {state.contacts
                      .filter((c) => c.roles.includes("customer"))
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </label>

                <label className="form-field">
                  <span>Issue Date *</span>
                  <input
                    type="date"
                    value={invIssueDate}
                    onChange={(e) => setInvIssueDate(e.target.value)}
                  />
                </label>

                <label className="form-field">
                  <span>Due Date *</span>
                  <input
                    type="date"
                    value={invDueDate}
                    onChange={(e) => setInvDueDate(e.target.value)}
                  />
                </label>
              </div>

              <div className="field-block" style={{ marginTop: 14 }}>
                <h4>Line Items</h4>
                {invLines.map((line, idx) => (
                  <div className="line-item-row" key={line.id}>
                    <input
                      type="text"
                      placeholder="Item or service description"
                      value={line.description}
                      onChange={(e) =>
                        setInvLines((prev) =>
                          prev.map((l, i) =>
                            i === idx ? { ...l, description: e.target.value } : l,
                          ),
                        )
                      }
                    />
                    <input
                      type="number"
                      min="1"
                      placeholder="Qty"
                      style={{ maxWidth: 90 }}
                      value={line.quantity}
                      onChange={(e) =>
                        setInvLines((prev) =>
                          prev.map((l, i) =>
                            i === idx ? { ...l, quantity: e.target.value } : l,
                          ),
                        )
                      }
                    />
                    <input
                      type="text"
                      placeholder="Unit price (NGN)"
                      style={{ maxWidth: 160 }}
                      value={line.unitPriceNaira}
                      onChange={(e) =>
                        setInvLines((prev) =>
                          prev.map((l, i) =>
                            i === idx ? { ...l, unitPriceNaira: e.target.value } : l,
                          ),
                        )
                      }
                    />
                    {invLines.length > 1 && (
                      <button
                        type="button"
                        className="subtle-btn danger-text"
                        onClick={() =>
                          setInvLines((prev) => prev.filter((_, i) => i !== idx))
                        }
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  className="secondary-btn"
                  style={{ marginTop: 8 }}
                  onClick={() =>
                    setInvLines((prev) => [
                      ...prev,
                      {
                        id: `line-${Date.now()}`,
                        description: "",
                        quantity: "1",
                        unitPriceNaira: "10000.00",
                      },
                    ])
                  }
                >
                  ＋ Add line item
                </button>
              </div>

              <div className="form-grid" style={{ marginTop: 14 }}>
                <label className="form-field">
                  <span>Discount in NGN (Optional)</span>
                  <input
                    type="text"
                    value={invDiscountInput}
                    onChange={(e) => setInvDiscountInput(e.target.value)}
                  />
                </label>

                <label className="form-field">
                  <span>Configurable Tax Label & Rate (%)</span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      type="text"
                      value={invTaxLabel}
                      onChange={(e) => setInvTaxLabel(e.target.value)}
                      placeholder="e.g. VAT"
                    />
                    <input
                      type="number"
                      step="0.5"
                      style={{ maxWidth: 90 }}
                      value={invTaxRate}
                      onChange={(e) => setInvTaxRate(e.target.value)}
                    />
                  </div>
                  <small>User-configured record field; not statutory tax advice.</small>
                </label>

                <label className="form-field full-span">
                  <span>Payment Instructions (Supplied by your business) *</span>
                  <input
                    type="text"
                    value={invPaymentInstr}
                    onChange={(e) => setInvPaymentInstr(e.target.value)}
                  />
                </label>

                <label className="form-field full-span">
                  <span>Payment Terms</span>
                  <input
                    type="text"
                    value={invTerms}
                    onChange={(e) => setInvTerms(e.target.value)}
                  />
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="secondary-btn"
                onClick={() => handleCreateSubmit("draft")}
              >
                Save as draft
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => handleCreateSubmit("shared")}
              >
                Issue & mark shared
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Invoice Preview & Detail Modal */}
      {selectedInvoiceObj && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="inv-preview-title">
          <div className="modal-card wide-modal">
            <div className="modal-header">
              <div>
                <span className="brief-label">
                  ORDINARY LEDGERLY INVOICE · NOT AN NRS FISCAL E-INVOICE
                </span>
                <h2 id="inv-preview-title">
                  {selectedInvoiceObj.invoice.invoiceNumber} ·{" "}
                  {contactsById.get(selectedInvoiceObj.invoice.customerId)?.name}
                </h2>
              </div>
              <button
                type="button"
                className="close-btn"
                onClick={() => setSelectedInvoiceId(null)}
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              <div className="invoice-preview-sheet">
                <div className="invoice-sheet-top">
                  <div>
                    <h3>{state.workspace.legalName}</h3>
                    <p>{state.workspace.stateCity} · Nigeria</p>
                    {state.workspace.taxId && <small>{state.workspace.taxId}</small>}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <span className="tag amber">
                      {selectedInvoiceObj.calc.effectiveState.replace("_", " ").toUpperCase()}
                    </span>
                    <p style={{ marginTop: 6 }}>
                      <b>Issued:</b> {formatDisplayDate(selectedInvoiceObj.invoice.issueDate)}
                      <br />
                      <b>Due:</b> {formatDisplayDate(selectedInvoiceObj.invoice.dueDate)}
                    </p>
                  </div>
                </div>

                <table>
                  <thead>
                    <tr>
                      <th>Description</th>
                      <th>Qty</th>
                      <th>Unit Price</th>
                      <th>Line Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedInvoiceObj.invoice.lines.map((line) => (
                      <tr key={line.id}>
                        <td className="description">{line.description}</td>
                        <td>{line.quantity}</td>
                        <td>{formatNgn(line.unitPriceKobo)}</td>
                        <td>{formatNgn(Math.round(line.quantity * line.unitPriceKobo))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="invoice-totals-box">
                  <div>
                    <span>Subtotal:</span>
                    <b>{formatNgn(selectedInvoiceObj.calc.subtotalKobo)}</b>
                  </div>
                  {selectedInvoiceObj.calc.discountKobo > 0 && (
                    <div>
                      <span>Discount:</span>
                      <b>−{formatNgn(selectedInvoiceObj.calc.discountKobo)}</b>
                    </div>
                  )}
                  <div>
                    <span>
                      {selectedInvoiceObj.invoice.taxLabel ?? "Tax"} (
                      {selectedInvoiceObj.invoice.taxRatePercent ?? 0}%):
                    </span>
                    <b>{formatNgn(selectedInvoiceObj.calc.taxKobo)}</b>
                  </div>
                  <div className="grand-total">
                    <span>Total (NGN):</span>
                    <strong>{formatNgn(selectedInvoiceObj.calc.totalKobo)}</strong>
                  </div>
                  <div>
                    <span>Confirmed Receipts:</span>
                    <b className="positive">
                      {formatNgn(selectedInvoiceObj.calc.paidKobo)}
                    </b>
                  </div>
                  <div className="grand-total">
                    <span>Outstanding Balance:</span>
                    <strong className={selectedInvoiceObj.calc.outstandingKobo > 0 ? "negative" : "positive"}>
                      {formatNgn(selectedInvoiceObj.calc.outstandingKobo)}
                    </strong>
                  </div>
                </div>

                <div className="field-block" style={{ marginTop: 12 }}>
                  <h4>Payment Instructions (Supplied by {state.workspace.displayName})</h4>
                  <p>{selectedInvoiceObj.invoice.paymentInstructions}</p>
                  <small>Terms: {selectedInvoiceObj.invoice.terms}</small>
                </div>

                {selectedInvoiceObj.invoice.receipts.length > 0 && (
                  <div className="field-block" style={{ marginTop: 12 }}>
                    <h4>Recorded Receipts ({selectedInvoiceObj.invoice.receipts.length})</h4>
                    <table>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Method</th>
                          <th>Reference</th>
                          <th>Recorded By</th>
                          <th>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedInvoiceObj.invoice.receipts.map((r) => (
                          <tr key={r.id}>
                            <td>{formatDisplayDate(r.date)}</td>
                            <td>{r.methodLabel}</td>
                            <td><code>{r.reference}</code></td>
                            <td>{r.recordedBy}</td>
                            <td className="positive">+{formatNgn(r.amountKobo)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="secondary-btn"
                onClick={() => window.print()}
              >
                🖨 Print / Save PDF
              </button>
              {selectedInvoiceObj.calc.outstandingKobo > 0 &&
                selectedInvoiceObj.invoice.status !== "cancelled" &&
                canRecordReceipt && (
                  <button
                    type="button"
                    className="primary"
                    onClick={() => {
                      const id = selectedInvoiceObj.invoice.id;
                      const out = selectedInvoiceObj.calc.outstandingKobo;
                      setSelectedInvoiceId(null);
                      setReceiptInvoiceId(id);
                      setRcpAmountInput((out / 100).toFixed(2));
                      setRcpConfirmed(false);
                      setRcpError(null);
                    }}
                  >
                    Record payment receipt
                  </button>
                )}
            </div>
          </div>
        </div>
      )}

      {/* Record Receipt Modal */}
      {receiptInvoiceObj && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="rcp-modal-title">
          <div className="modal-card">
            <div className="modal-header">
              <div>
                <span className="brief-label">CONFIRM CUSTOMER RECEIPT</span>
                <h2 id="rcp-modal-title">
                  Record receipt for {receiptInvoiceObj.invoice.invoiceNumber}
                </h2>
              </div>
              <button
                type="button"
                className="close-btn"
                onClick={() => setReceiptInvoiceId(null)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="evidence-summary-box">
                <div>
                  <small>Invoice Total</small>
                  <b>{formatNgn(receiptInvoiceObj.calc.totalKobo)}</b>
                </div>
                <div>
                  <small>Already Paid</small>
                  <b className="positive">{formatNgn(receiptInvoiceObj.calc.paidKobo)}</b>
                </div>
                <div>
                  <small>Remaining Balance</small>
                  <strong>{formatNgn(receiptInvoiceObj.calc.outstandingKobo)}</strong>
                </div>
              </div>

              {rcpError && (
                <div className="error-banner" role="alert">
                  {rcpError}
                </div>
              )}

              <div className="form-grid">
                <label className="form-field">
                  <span>Receipt Date *</span>
                  <input
                    type="date"
                    value={rcpDate}
                    onChange={(e) => setRcpDate(e.target.value)}
                  />
                </label>

                <label className="form-field">
                  <span>Amount Received in NGN *</span>
                  <input
                    type="text"
                    value={rcpAmountInput}
                    onChange={(e) => setRcpAmountInput(e.target.value)}
                  />
                  <small>Partial payments are supported. Cannot exceed remaining balance.</small>
                </label>

                <label className="form-field">
                  <span>Destination Tracking Label *</span>
                  <select
                    value={rcpAccount}
                    onChange={(e) => setRcpAccount(e.target.value)}
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
                  <span>Payment Method Label *</span>
                  <input
                    type="text"
                    value={rcpMethod}
                    onChange={(e) => setRcpMethod(e.target.value)}
                  />
                </label>

                <label className="form-field full-span">
                  <span>Bank / POS Reference *</span>
                  <input
                    type="text"
                    placeholder="e.g. NIP-GTB-88301"
                    value={rcpRef}
                    onChange={(e) => setRcpRef(e.target.value)}
                  />
                </label>

                <label className="checkbox-field full-span">
                  <input
                    type="checkbox"
                    checked={rcpConfirmed}
                    onChange={(e) => setRcpConfirmed(e.target.checked)}
                  />
                  <span>
                    I confirm this payment was actually received by the business (Ledgerly does not verify bank transfers automatically in MVP).
                  </span>
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="secondary-btn"
                onClick={() => setReceiptInvoiceId(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                onClick={handleRecordReceiptSubmit}
              >
                Confirm receipt & post inflow
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reminder Template Review Modal */}
      {reminderInvoiceObj && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="rem-modal-title">
          <div className="modal-card">
            <div className="modal-header">
              <div>
                <span className="brief-label">CUSTOMER REMINDER REVIEW</span>
                <h2 id="rem-modal-title">
                  Follow up on {reminderInvoiceObj.invoice.invoiceNumber}
                </h2>
              </div>
              <button
                type="button"
                className="close-btn"
                onClick={() => setReminderInvoiceId(null)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 12, color: "var(--muted)" }}>
                Per privacy guardrails, sensitive NGN amounts are omitted from the email subject line by default.
              </p>
              <div className="field-block">
                <h4>Subject Line</h4>
                <p>
                  <code>
                    Invoice {reminderInvoiceObj.invoice.invoiceNumber} follow-up from{" "}
                    {state.workspace.displayName}
                  </code>
                </p>
              </div>
              <div className="field-block">
                <h4>Message Preview</h4>
                <textarea ref={reminderTextRef} className="code-textarea" rows={9} readOnly aria-label="Reminder draft text" value={`Dear ${contactsById.get(reminderInvoiceObj.invoice.customerId)?.name ?? "Customer"},\n\nWe hope your week is going well. This is a polite reminder that Invoice ${reminderInvoiceObj.invoice.invoiceNumber} (issued ${formatDisplayDate(reminderInvoiceObj.invoice.issueDate)}) has an outstanding balance of ${formatNgn(reminderInvoiceObj.calc.outstandingKobo)}, which was due on ${formatDisplayDate(reminderInvoiceObj.invoice.dueDate)}.\n\n${reminderInvoiceObj.invoice.paymentInstructions}\n\nIf you have already sent payment, please share the transfer reference so we can update your receipt record.\n\nWarm regards,\n${state.workspace.displayName}`} />
                <p className="sub-meta">Ledgerly prepares this message only; you decide whether and where to send it.</p>
                {reminderError && <p className="form-error" role="alert">{reminderError}</p>}
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="secondary-btn"
                onClick={() => setReminderInvoiceId(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                onClick={async () => {
                  setReminderError(null);
                  try {
                    await navigator.clipboard.writeText(reminderTextRef.current?.value ?? "");
                    onSendReminder(reminderInvoiceObj.invoice.id);
                    setReminderInvoiceId(null);
                  } catch {
                    reminderTextRef.current?.focus();
                    reminderTextRef.current?.select();
                    setReminderError("Clipboard access was blocked. The draft is selected so you can copy it manually.");
                  }
                }}
              >
                Copy reminder draft
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

