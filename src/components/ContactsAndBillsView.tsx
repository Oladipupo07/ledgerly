"use client";

import React, { useState, useMemo } from "react";
import {
  WorkspaceState,
  Contact,
  SupplierBill,
  computeInvoiceTotals,
  computeBillStatus,
  formatDisplayDate,
  CURRENT_REFERENCE_DATE,
} from "@/lib/domain";
import { formatNgn, parseNairaToKobo } from "@/lib/money";

interface ContactsAndBillsViewProps {
  mode: "customers" | "suppliers";
  state: WorkspaceState;
  canWrite: boolean;
  onCreateContact: (payload: {
    name: string;
    roles: ("customer" | "supplier")[];
    email?: string;
    phone?: string;
    businessId?: string;
    notes?: string;
    confirmDuplicate?: boolean;
  }) => void;
  onCreateBill: (payload: {
    billNumber: string;
    supplierId: string;
    billDate: string;
    dueDate: string;
    amountKobo: number;
    categoryId: string;
    reference?: string;
    notes?: string;
  }) => void;
  onRecordBillPayment: (payload: {
    billId: string;
    amountKobo: number;
    trackingAccountId: string;
    reference: string;
  }) => void;
  onToggleArchiveContact?: (contactId: string, nextStatus: "active" | "archived") => void;
  onCancelBill?: (billId: string) => void;
}

export function ContactsAndBillsView({
  mode,
  state,
  canWrite,
  onCreateContact,
  onCreateBill,
  onRecordBillPayment,
  onToggleArchiveContact,
  onCancelBill,
}: ContactsAndBillsViewProps) {
  const [search, setSearch] = useState("");
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [showContactModal, setShowContactModal] = useState(false);
  const [showBillModal, setShowBillModal] = useState(false);
  const [payingBill, setPayingBill] = useState<SupplierBill | null>(null);

  // New Contact Form
  const [cntName, setCntName] = useState("");
  const [cntIsCustomer, setCntIsCustomer] = useState(mode === "customers");
  const [cntIsSupplier, setCntIsSupplier] = useState(mode === "suppliers");
  const [cntEmail, setCntEmail] = useState("");
  const [cntPhone, setCntPhone] = useState("");
  const [cntBizId, setCntBizId] = useState("");
  const [cntNotes, setCntNotes] = useState("");
  const [cntConfirmDuplicate, setCntConfirmDuplicate] = useState(false);
  const [cntError, setCntError] = useState<string | null>(null);

  // New Bill Form
  const [billNumber, setBillNumber] = useState(`BILL-0${state.bills.length + 18}`);
  const [billSupplier, setBillSupplier] = useState(
    state.contacts.find((c) => c.roles.includes("supplier"))?.id ?? "",
  );
  const [billDate, setBillDate] = useState(CURRENT_REFERENCE_DATE);
  const [billDueDate, setBillDueDate] = useState(() => {
    const date = new Date(`${CURRENT_REFERENCE_DATE}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + 7);
    return date.toISOString().slice(0, 10);
  });
  const [billAmountInput, setBillAmountInput] = useState("");
  const [billCategory, setBillCategory] = useState(
    state.categories.find((c) => c.type === "expense")?.id ?? state.categories[0]?.id ?? "",
  );
  const [billRef, setBillRef] = useState("");
  const [billNotes, setBillNotes] = useState("");
  const [billError, setBillError] = useState<string | null>(null);

  // Record Bill Payment Form
  const [payAmountInput, setPayAmountInput] = useState("");
  const [payAccount, setPayAccount] = useState(state.trackingAccounts[0]?.id ?? "");
  const [payRef, setPayRef] = useState("");
  const [payError, setPayError] = useState<string | null>(null);

  const duplicateCandidate = useMemo(() => {
    const normName = cntName.trim().toLowerCase();
    const normEmail = cntEmail.trim().toLowerCase();
    if (!normName && !normEmail) return null;
    return (
      state.contacts.find(
        (c) =>
          (normName && c.name.toLowerCase() === normName) ||
          (normEmail && c.email && c.email.toLowerCase() === normEmail),
      ) ?? null
    );
  }, [cntName, cntEmail, state.contacts]);

  const roleFilteredContacts = useMemo(() => {
    const targetRole = mode === "customers" ? "customer" : "supplier";
    return state.contacts.filter((c) => {
      if (!c.roles.includes(targetRole)) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          c.name.toLowerCase().includes(q) ||
          (c.email ?? "").toLowerCase().includes(q) ||
          (c.phone ?? "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [state.contacts, mode, search]);

  const contactSummaries = useMemo(
    () => roleFilteredContacts.map((contact) => {
      const openInvoices = state.invoices
        .filter((invoice) => invoice.customerId === contact.id)
        .map((invoice) => computeInvoiceTotals(invoice))
        .filter((invoice) => invoice.outstandingKobo > 0);
      const openBills = state.bills
        .filter((bill) => bill.supplierId === contact.id)
        .map((bill) => computeBillStatus(bill))
        .filter((bill) => bill.outstandingKobo > 0);
      const isCustomerList = mode === "customers";
      return {
        contact,
        openCount: isCustomerList ? openInvoices.length : openBills.length,
        outstandingKobo: isCustomerList
          ? openInvoices.reduce((total, invoice) => total + invoice.outstandingKobo, 0)
          : openBills.reduce((total, bill) => total + bill.outstandingKobo, 0),
      };
    }),
    [roleFilteredContacts, state.invoices, state.bills, mode],
  );

  const evaluatedBills = useMemo(() => {
    return state.bills.map((bill) => ({
      bill,
      calc: computeBillStatus(bill),
    }));
  }, [state.bills]);

  const handleCreateContactSubmit = () => {
    setCntError(null);
    if (!cntName.trim()) {
      setCntError("Contact name is required.");
      return;
    }
    if (!cntIsCustomer && !cntIsSupplier) {
      setCntError("Select at least one role (Customer and/or Supplier).");
      return;
    }
    if (duplicateCandidate && !cntConfirmDuplicate) {
      setCntError(
        `Possible duplicate of "${duplicateCandidate.name}". Check the confirmation box below if you still want to create a separate contact.`,
      );
      return;
    }

    const roles: ("customer" | "supplier")[] = [];
    if (cntIsCustomer) roles.push("customer");
    if (cntIsSupplier) roles.push("supplier");

    onCreateContact({
      name: cntName.trim(),
      roles,
      email: cntEmail.trim() || undefined,
      phone: cntPhone.trim() || undefined,
      businessId: cntBizId.trim() || undefined,
      notes: cntNotes.trim() || undefined,
      confirmDuplicate: cntConfirmDuplicate,
    });

    setCntName("");
    setCntEmail("");
    setCntPhone("");
    setCntBizId("");
    setCntNotes("");
    setCntConfirmDuplicate(false);
    setShowContactModal(false);
  };

  const handleCreateBillSubmit = () => {
    setBillError(null);
    if (!billNumber.trim()) {
      setBillError("Bill number is required.");
      return;
    }
    if (!billSupplier) {
      setBillError("Select a supplier.");
      return;
    }
    let amountKobo = 0;
    try {
      amountKobo = parseNairaToKobo(billAmountInput);
    } catch (err) {
      setBillError(err instanceof Error ? err.message : "Enter a valid NGN bill amount.");
      return;
    }

    onCreateBill({
      billNumber: billNumber.trim().toUpperCase(),
      supplierId: billSupplier,
      billDate,
      dueDate: billDueDate,
      amountKobo,
      categoryId: billCategory,
      reference: billRef.trim() || undefined,
      notes: billNotes.trim() || undefined,
    });

    setShowBillModal(false);
    setBillAmountInput("");
    setBillRef("");
    setBillNotes("");
  };

  const handlePayBillSubmit = () => {
    if (!payingBill) return;
    setPayError(null);
    const calc = computeBillStatus(payingBill);
    let amountKobo = 0;
    try {
      amountKobo = parseNairaToKobo(payAmountInput);
    } catch (err) {
      setPayError(err instanceof Error ? err.message : "Enter a valid NGN amount.");
      return;
    }
    if (amountKobo > calc.outstandingKobo) {
      setPayError(
        `Payment amount cannot exceed outstanding bill balance (${formatNgn(calc.outstandingKobo)}).`,
      );
      return;
    }
    if (!payRef.trim()) {
      setPayError("Enter a payment reference for your bookkeeping trail.");
      return;
    }
    onRecordBillPayment({
      billId: payingBill.id,
      amountKobo,
      trackingAccountId: payAccount,
      reference: payRef.trim(),
    });
    setPayingBill(null);
  };

  return (
    <div className="page-wrap">
      <div className="heading-row">
        <div>
          <p className="eyebrow">
            {mode === "customers"
              ? "CUSTOMERS & RECEIVABLE BALANCES"
              : "SUPPLIERS & PAYABLE OBLIGATIONS"}
          </p>
          <h1>{mode === "customers" ? "Customers" : "Suppliers & Bills"}</h1>
          <p className="subheading">
            {mode === "customers"
              ? "Manage customer profiles, open invoices, and collection history. One contact can serve as both customer and supplier."
              : "Track supplier bills, due dates, and recorded payment status. Recording a payment is a bookkeeping entry only."}
          </p>
        </div>
        <div className="heading-actions">
          {canWrite && (
            <>
              <button
                type="button"
                className="secondary-btn"
                onClick={() => {
                  setCntIsCustomer(mode === "customers");
                  setCntIsSupplier(mode === "suppliers");
                  setCntError(null);
                  setShowContactModal(true);
                }}
              >
                ＋ New {mode === "customers" ? "customer" : "supplier"}
              </button>
              {mode === "suppliers" && (
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    setBillNumber(`BILL-0${state.bills.length + 18}`);
                    setBillError(null);
                    setShowBillModal(true);
                  }}
                >
                  ＋ <span>Record supplier bill</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Search bar */}
      <section className="filter-bar">
        <input
          type="search"
          className="search-input"
          placeholder={`Search ${mode} by name, email, or phone…`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </section>

      {/* Directory Table */}
      <section className="panel transactions contact-directory-panel">
        <div className="panel-head">
          <div>
            <h2>
              {mode === "customers" ? "Customer Directory" : "Supplier Directory"} (
              {roleFilteredContacts.length})
            </h2>
            <p>Click any contact to open their full activity and balance profile</p>
          </div>
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Name & Roles</th>
                <th>Email / Phone</th>
                <th>Business ID</th>
                <th>
                  {mode === "customers" ? "Open Invoices" : "Unpaid Supplier Bills"}
                </th>
                <th>
                  {mode === "customers"
                    ? "Outstanding Receivable"
                    : "Upcoming / Overdue Payable"}
                </th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {contactSummaries.map(({ contact, openCount, outstandingKobo }) => {
                return (
                  <tr key={contact.id}>
                    <td className="description">
                      <button
                        type="button"
                        className="row-title-btn"
                        onClick={() => setSelectedContact(contact)}
                      >
                        {contact.name}
                      </button>
                      <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                        {contact.roles.map((r) => (
                          <span key={r} className="tag income">
                            {r.toUpperCase()}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      {contact.email ?? "—"}
                      <span className="sub-meta">{contact.phone ?? ""}</span>
                    </td>
                    <td>{contact.businessId ?? "—"}</td>
                    <td>
                      {`${openCount} open`}
                    </td>
                    <td className={outstandingKobo > 0 ? "negative" : "positive"}>
                      {formatNgn(outstandingKobo)}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="subtle-btn"
                        onClick={() => setSelectedContact(contact)}
                      >
                        View profile →
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="contact-cards" aria-label={`${mode} directory`}>
          {contactSummaries.map(({ contact, openCount, outstandingKobo }) => {
            return (
              <article className="contact-card" key={contact.id}>
                <div className="contact-card-title">
                  <button type="button" className="row-title-btn" onClick={() => setSelectedContact(contact)}>
                    {contact.name}
                  </button>
                  <div className="contact-card-roles">
                    {contact.roles.map((role) => <span key={role} className="tag income">{role.toUpperCase()}</span>)}
                  </div>
                </div>
                <dl>
                  <div><dt>Email / Phone</dt><dd>{contact.email ?? "—"}{contact.phone && <span>{contact.phone}</span>}</dd></div>
                  <div><dt>Business ID</dt><dd>{contact.businessId ?? "—"}</dd></div>
                  <div><dt>{mode === "customers" ? "Open invoices" : "Unpaid bills"}</dt><dd>{openCount}</dd></div>
                  <div><dt>{mode === "customers" ? "Outstanding" : "Payable"}</dt><dd className={outstandingKobo > 0 ? "negative" : "positive"}>{formatNgn(outstandingKobo)}</dd></div>
                </dl>
                <button type="button" className="subtle-btn" onClick={() => setSelectedContact(contact)}>View profile →</button>
              </article>
            );
          })}
        </div>
      </section>

      {/* Supplier Bills Section when in Suppliers mode */}
      {mode === "suppliers" && (
        <section className="panel transactions" style={{ marginTop: 18 }}>
          <div className="panel-head">
            <div>
              <h2>Supplier Bills & Obligations ({evaluatedBills.length})</h2>
              <p>Grouped by due urgency · Bookkeeping records only (no automatic bank payout)</p>
            </div>
          </div>

          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Bill #</th>
                  <th>Supplier</th>
                  <th>Bill Date</th>
                  <th>Due Date</th>
                  <th>Urgency / Status</th>
                  <th>Total Amount</th>
                  <th>Outstanding</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {evaluatedBills.map(({ bill, calc }) => {
                  const supplier = state.contacts.find((c) => c.id === bill.supplierId);
                  return (
                    <tr key={bill.id}>
                      <td className="description">{bill.billNumber}</td>
                      <td>{supplier?.name ?? "Supplier"}</td>
                      <td>{formatDisplayDate(bill.billDate)}</td>
                      <td>{formatDisplayDate(bill.dueDate)}</td>
                      <td>
                        <span
                          className={`tag ${
                            calc.effectiveStatus === "paid"
                              ? "income"
                              : calc.effectiveStatus === "overdue"
                                ? "coral"
                                : calc.effectiveStatus === "due_this_week"
                                  ? "amber"
                                  : "expense"
                          }`}
                        >
                          {calc.effectiveStatus.replaceAll("_", " ").toUpperCase()}
                        </span>
                      </td>
                      <td>{formatNgn(bill.amountKobo)}</td>
                      <td className={calc.outstandingKobo > 0 ? "negative" : "positive"}>
                        {formatNgn(calc.outstandingKobo)}
                      </td>
                      <td>
                        {calc.outstandingKobo > 0 && bill.status !== "cancelled" && canWrite ? (
                          <div className="table-actions">
                            <button
                              type="button"
                              className="link-btn"
                              onClick={() => {
                                setPayingBill(bill);
                                setPayAmountInput((calc.outstandingKobo / 100).toFixed(2));
                                setPayRef("");
                                setPayError(null);
                              }}
                            >
                              Record payment status
                            </button>
                            {bill.paidAmountKobo === 0 && onCancelBill && (
                              <button
                                type="button"
                                className="subtle-btn"
                                onClick={() => onCancelBill(bill.id)}
                              >
                                Cancel bill
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="sub-meta">{bill.status === "cancelled" ? "Cancelled" : "Settled"}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Contact Profile Modal */}
      {selectedContact && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="cnt-prof-title">
          <div className="modal-card wide-modal">
            <div className="modal-header">
              <div>
                <span className="brief-label">
                  CONTACT PROFILE · {selectedContact.roles.join(" & ").toUpperCase()}
                </span>
                <h2 id="cnt-prof-title">{selectedContact.name}</h2>
              </div>
              <button
                type="button"
                className="close-btn"
                onClick={() => setSelectedContact(null)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="detail-kv-grid">
                <div>
                  <small>Email</small>
                  <p>{selectedContact.email ?? "Not provided"}</p>
                </div>
                <div>
                  <small>Phone</small>
                  <p>{selectedContact.phone ?? "Not provided"}</p>
                </div>
                <div>
                  <small>CAC / Business Identifier</small>
                  <p>{selectedContact.businessId ?? "Optional / Not provided"}</p>
                </div>
                <div>
                  <small>Notes</small>
                  <p>{selectedContact.notes ?? "None"}</p>
                </div>
              </div>

              <div className="field-block" style={{ marginTop: 14 }}>
                <h4>Linked Transactions</h4>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Description</th>
                        <th>Type</th>
                        <th>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.transactions
                        .filter((t) => t.contactId === selectedContact.id)
                        .map((tx) => (
                          <tr key={tx.id}>
                            <td>{formatDisplayDate(tx.date)}</td>
                            <td className="description">{tx.description}</td>
                            <td>
                              <span className="tag income">{tx.type}</span>
                            </td>
                            <td className={tx.direction === "inflow" ? "positive" : "negative"}>
                              {tx.direction === "inflow" ? "+" : "−"}
                              {formatNgn(tx.amountKobo)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              {canWrite && onToggleArchiveContact && (
                <button
                  type="button"
                  className="subtle-btn"
                  onClick={() => {
                    const nextStatus = selectedContact.status === "archived" ? "active" : "archived";
                    onToggleArchiveContact(selectedContact.id, nextStatus);
                    setSelectedContact(null);
                  }}
                >
                  {selectedContact.status === "archived" ? "Restore contact" : "Archive contact"}
                </button>
              )}
              <button
                type="button"
                className="secondary-btn"
                onClick={() => setSelectedContact(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Contact Modal */}
      {showContactModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="new-cnt-title">
          <div className="modal-card">
            <div className="modal-header">
              <div>
                <span className="brief-label">WORKSPACE DIRECTORY</span>
                <h2 id="new-cnt-title">Add customer or supplier</h2>
              </div>
              <button
                type="button"
                className="close-btn"
                onClick={() => setShowContactModal(false)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              {cntError && (
                <div className="error-banner" role="alert">
                  {cntError}
                </div>
              )}

              {duplicateCandidate && (
                <div className="warning-note">
                  <b>Duplicate suggestion:</b> A contact named{" "}
                  <b>{duplicateCandidate.name}</b> ({duplicateCandidate.email ?? "no email"}) already exists.
                  <label className="checkbox-field" style={{ marginTop: 6 }}>
                    <input
                      type="checkbox"
                      checked={cntConfirmDuplicate}
                      onChange={(e) => setCntConfirmDuplicate(e.target.checked)}
                    />
                    <span>I confirm this is a distinct contact and want to create it anyway.</span>
                  </label>
                </div>
              )}

              <div className="form-grid">
                <label className="form-field full-span">
                  <span>Business or Contact Name *</span>
                  <input
                    type="text"
                    placeholder="e.g. Lagos Island Fabrics Ltd"
                    value={cntName}
                    onChange={(e) => setCntName(e.target.value)}
                  />
                </label>

                <div className="form-field full-span">
                  <span>Contact Role(s) *</span>
                  <div style={{ display: "flex", gap: 18, marginTop: 6 }}>
                    <label className="checkbox-field">
                      <input
                        type="checkbox"
                        checked={cntIsCustomer}
                        onChange={(e) => setCntIsCustomer(e.target.checked)}
                      />
                      <span>Customer (Billed via invoices)</span>
                    </label>
                    <label className="checkbox-field">
                      <input
                        type="checkbox"
                        checked={cntIsSupplier}
                        onChange={(e) => setCntIsSupplier(e.target.checked)}
                      />
                      <span>Supplier (Issues bills to us)</span>
                    </label>
                  </div>
                </div>

                <label className="form-field">
                  <span>Email (Optional)</span>
                  <input
                    type="email"
                    placeholder="accounts@company.ng"
                    value={cntEmail}
                    onChange={(e) => setCntEmail(e.target.value)}
                  />
                </label>

                <label className="form-field">
                  <span>Phone (Optional)</span>
                  <input
                    type="text"
                    placeholder="+234 803 000 0000"
                    value={cntPhone}
                    onChange={(e) => setCntPhone(e.target.value)}
                  />
                </label>

                <label className="form-field full-span">
                  <span>Optional CAC / Business Identifier</span>
                  <input
                    type="text"
                    placeholder="e.g. RC-102938"
                    value={cntBizId}
                    onChange={(e) => setCntBizId(e.target.value)}
                  />
                </label>

                <label className="form-field full-span">
                  <span>Notes</span>
                  <input
                    type="text"
                    placeholder="Payment terms, delivery address, or contact person"
                    value={cntNotes}
                    onChange={(e) => setCntNotes(e.target.value)}
                  />
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="secondary-btn"
                onClick={() => setShowContactModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                onClick={handleCreateContactSubmit}
              >
                Save contact
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Supplier Bill Modal */}
      {showBillModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="new-bill-title">
          <div className="modal-card">
            <div className="modal-header">
              <div>
                <span className="brief-label">SUPPLIER OBLIGATION</span>
                <h2 id="new-bill-title">Record supplier bill</h2>
              </div>
              <button
                type="button"
                className="close-btn"
                onClick={() => setShowBillModal(false)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              {billError && (
                <div className="error-banner" role="alert">
                  {billError}
                </div>
              )}

              <div className="form-grid">
                <label className="form-field">
                  <span>Bill Number *</span>
                  <input
                    type="text"
                    value={billNumber}
                    onChange={(e) => setBillNumber(e.target.value)}
                  />
                </label>

                <label className="form-field">
                  <span>Supplier *</span>
                  <select
                    value={billSupplier}
                    onChange={(e) => setBillSupplier(e.target.value)}
                  >
                    {state.contacts
                      .filter((c) => c.roles.includes("supplier"))
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </label>

                <label className="form-field">
                  <span>Bill Date *</span>
                  <input
                    type="date"
                    value={billDate}
                    onChange={(e) => setBillDate(e.target.value)}
                  />
                </label>

                <label className="form-field">
                  <span>Due Date *</span>
                  <input
                    type="date"
                    value={billDueDate}
                    onChange={(e) => setBillDueDate(e.target.value)}
                  />
                </label>

                <label className="form-field">
                  <span>Bill Amount in NGN *</span>
                  <input
                    type="text"
                    placeholder="e.g. 62000.00"
                    value={billAmountInput}
                    onChange={(e) => setBillAmountInput(e.target.value)}
                  />
                </label>

                <label className="form-field">
                  <span>Expense Category *</span>
                  <select
                    value={billCategory}
                    onChange={(e) => setBillCategory(e.target.value)}
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
                  <span>Supplier Invoice Reference</span>
                  <input
                    type="text"
                    placeholder="e.g. MIDAS-INV-901"
                    value={billRef}
                    onChange={(e) => setBillRef(e.target.value)}
                  />
                </label>

                <label className="form-field full-span">
                  <span>Notes</span>
                  <input
                    type="text"
                    placeholder="Goods delivered or payment instructions"
                    value={billNotes}
                    onChange={(e) => setBillNotes(e.target.value)}
                  />
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="secondary-btn"
                onClick={() => setShowBillModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                onClick={handleCreateBillSubmit}
              >
                Save supplier obligation
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Record Supplier Bill Payment Modal */}
      {payingBill && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="pay-bill-title">
          <div className="modal-card">
            <div className="modal-header">
              <div>
                <span className="brief-label">BOOKKEEPING PAYMENT RECORD ONLY</span>
                <h2 id="pay-bill-title">Record payment for {payingBill.billNumber}</h2>
              </div>
              <button
                type="button"
                className="close-btn"
                onClick={() => setPayingBill(null)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p className="warning-note">
                Recording this status updates your supplier obligation and posts an expense entry in Ledgerly. Ledgerly does not initiate bank transfers.
              </p>

              {payError && (
                <div className="error-banner" role="alert">
                  {payError}
                </div>
              )}

              <div className="form-grid">
                <label className="form-field">
                  <span>Amount Paid in NGN *</span>
                  <input
                    type="text"
                    value={payAmountInput}
                    onChange={(e) => setPayAmountInput(e.target.value)}
                  />
                </label>

                <label className="form-field">
                  <span>Paid From Tracking Label *</span>
                  <select
                    value={payAccount}
                    onChange={(e) => setPayAccount(e.target.value)}
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

                <label className="form-field full-span">
                  <span>Bank / Receipt Reference *</span>
                  <input
                    type="text"
                    placeholder="e.g. TRF-GTB-8812"
                    value={payRef}
                    onChange={(e) => setPayRef(e.target.value)}
                  />
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="secondary-btn"
                onClick={() => setPayingBill(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                onClick={handlePayBillSubmit}
              >
                Confirm bookkeeping payment
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

