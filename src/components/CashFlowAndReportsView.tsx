"use client";

import React, { useState, useMemo } from "react";
import {
  WorkspaceState,
  computeTrackingAccountBalances,
  computeInvoiceTotals,
  computeBillStatus,
  formatDisplayDate,
  CURRENT_REFERENCE_DATE,
} from "@/lib/domain";
import { formatNgn } from "@/lib/money";

interface CashFlowAndReportsViewProps {
  mode: "cashflow" | "reports";
  state: WorkspaceState;
  canExport: boolean;
  onExportReport: (type: "income-expense" | "cash-movement" | "receivables" | "payables", from: string, to: string) => Promise<void>;
}

type ReportKind = "income_expense" | "cash_movement" | "receivables_aging" | "payables_due";

export function CashFlowAndReportsView({
  mode,
  state,
  canExport,
  onExportReport,
}: CashFlowAndReportsViewProps) {
  const [selectedReport, setSelectedReport] = useState<ReportKind>("income_expense");
  const [filterAccount, setFilterAccount] = useState<string>("all");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [exportToast, setExportToast] = useState<string | null>(null);
  const [exportFrom, setExportFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [exportTo, setExportTo] = useState(CURRENT_REFERENCE_DATE);
  const [exportBusy, setExportBusy] = useState(false);

  const accountBalances = useMemo(
    () => computeTrackingAccountBalances(state),
    [state],
  );

  const totalRecordedCashKobo = useMemo(
    () => accountBalances.reduce((s, a) => s + a.recordedBalanceKobo, 0),
    [accountBalances],
  );

  const totalOpeningKobo = useMemo(
    () => accountBalances.reduce((s, a) => s + a.account.openingBalanceKobo, 0),
    [accountBalances],
  );

  const totalInflowKobo = useMemo(
    () => accountBalances.reduce((s, a) => s + a.inflowKobo, 0),
    [accountBalances],
  );

  const totalOutflowKobo = useMemo(
    () => accountBalances.reduce((s, a) => s + a.outflowKobo, 0),
    [accountBalances],
  );

  const filteredPostedTransactions = useMemo(() => {
    return state.transactions.filter((tx) => {
      if (tx.status !== "posted") return false;
      if (filterAccount !== "all" && tx.trackingAccountId !== filterAccount) return false;
      if (filterCategory !== "all" && tx.categoryId !== filterCategory) return false;
      return true;
    });
  }, [state.transactions, filterAccount, filterCategory]);

  const categoryBreakdown = useMemo(() => {
    const map = new Map<
      string,
      { categoryId: string; name: string; inflowKobo: number; outflowKobo: number; count: number }
    >();
    for (const cat of state.categories) {
      map.set(cat.id, {
        categoryId: cat.id,
        name: cat.name,
        inflowKobo: 0,
        outflowKobo: 0,
        count: 0,
      });
    }
    for (const tx of filteredPostedTransactions) {
      if (tx.type === "transfer") continue;
      const item = map.get(tx.categoryId) ?? {
        categoryId: tx.categoryId,
        name: "Uncategorized",
        inflowKobo: 0,
        outflowKobo: 0,
        count: 0,
      };
      item.count += 1;
      if (tx.direction === "inflow") {
        item.inflowKobo += tx.amountKobo;
      } else {
        item.outflowKobo += tx.amountKobo;
      }
      map.set(tx.categoryId, item);
    }
    return Array.from(map.values()).filter((x) => x.count > 0);
  }, [state.categories, filteredPostedTransactions]);

  const handleDownloadCsv = async () => {
    const types = { income_expense: "income-expense", cash_movement: "cash-movement", receivables_aging: "receivables", payables_due: "payables" } as const;
    setExportBusy(true);
    setExportToast(null);
    try {
      await onExportReport(types[selectedReport], exportFrom, exportTo);
      setExportToast("Report exported from server records for the selected period.");
    } catch (error) { setExportToast(error instanceof Error ? error.message : "Could not export this report."); }
    finally { setExportBusy(false); }
  };

  if (mode === "cashflow") {
    return (
      <div className="page-wrap">
        <div className="heading-row">
          <div>
            <p className="eyebrow">RECORDED CASH POSITION & MOVEMENT (RETROSPECTIVE)</p>
            <h1>Cash flow</h1>
            <p className="subheading">
              Reconciled from opening balances provided by you plus posted inflows and outflows. Tracking labels are non-custodial bookkeeping records, not live bank connections.
            </p>
          </div>
        </div>

        <section className="metrics" aria-label="Cash flow summary">
          <article className="metric">
            <div>
              <span>Opening Recorded Balance</span>
              <span className="metric-icon">◫</span>
            </div>
            <strong>{formatNgn(totalOpeningKobo)}</strong>
            <small>Provided by user as of 01 Oct 2026</small>
          </article>

          <article className="metric">
            <div>
              <span>Total Posted Inflows</span>
              <span className="metric-icon green">＋</span>
            </div>
            <strong className="positive">+{formatNgn(totalInflowKobo)}</strong>
            <small>Includes receipts, sales & internal transfers in</small>
          </article>

          <article className="metric">
            <div>
              <span>Total Posted Outflows</span>
              <span className="metric-icon coral">−</span>
            </div>
            <strong className="negative">−{formatNgn(totalOutflowKobo)}</strong>
            <small>Includes expenses, bills paid & transfers out</small>
          </article>

          <article className="metric">
            <div>
              <span>Total Recorded Cash</span>
              <span className="metric-icon green">✓</span>
            </div>
            <strong>{formatNgn(totalRecordedCashKobo)}</strong>
            <small>As of {formatDisplayDate(CURRENT_REFERENCE_DATE)} (Not a live bank feed)</small>
          </article>
        </section>

        <section className="panel transactions">
          <div className="panel-head">
            <div>
              <h2>Recorded Position by Tracking Label</h2>
              <p>Each tracking label represents a record maintained by your team</p>
            </div>
          </div>

          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Tracking Label</th>
                  <th>Reference / Type</th>
                  <th>Opening Balance (User-provided)</th>
                  <th>Posted Inflows</th>
                  <th>Posted Outflows</th>
                  <th>Recorded Balance (NGN)</th>
                </tr>
              </thead>
              <tbody>
                {accountBalances.map((item) => (
                  <tr key={item.account.id}>
                    <td className="description">{item.account.name}</td>
                    <td>
                      <span className="tag expense">
                        {item.account.kind.replace("_label", "").toUpperCase()}
                      </span>{" "}
                      <span className="sub-meta">{item.account.maskedRef}</span>
                    </td>
                    <td>
                      {formatNgn(item.account.openingBalanceKobo)}
                      <span className="sub-meta">
                        As of {formatDisplayDate(item.account.openingBalanceDate)}
                      </span>
                    </td>
                    <td className="positive">+{formatNgn(item.inflowKobo)}</td>
                    <td className="negative">−{formatNgn(item.outflowKobo)}</td>
                    <td>
                      <b>{formatNgn(item.recordedBalanceKobo)}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    );
  }

  // Reports Mode
  return (
    <div className="page-wrap">
      <div className="heading-row">
        <div>
          <p className="eyebrow">BUSINESS REPORTS & ACCOUNTANT EXPORTS</p>
          <h1>Reports</h1>
          <p className="subheading">
            Every report reconciles directly to visible underlying records. General management reports are not statutory accounts or certified tax filings.
          </p>
        </div>
        <div className="heading-actions">
          {canExport && (
            <>
              <button
                type="button"
                className="secondary-btn"
                onClick={() => window.print()}
              >
                🖨 Print / Save PDF
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => void handleDownloadCsv()}
                disabled={exportBusy || !exportFrom || !exportTo}
              >
                ↓ <span>{exportBusy ? "Exporting…" : "Export CSV"}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {exportToast && (
        <div className="coverage" role="status">
          <span className="pulse" />
          <span>{exportToast}</span>
          <button
            type="button"
            className="coverage-link-btn"
            onClick={() => setExportToast(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Report Type Selector Cards */}
      <section className="metrics" aria-label="Select report type">
        {(
          [
            {
              id: "income_expense",
              title: "Income & Expense Summary",
              sub: "Driven by transaction date",
            },
            {
              id: "cash_movement",
              title: "Cash Movement by Label",
              sub: "Opening + inflows − outflows",
            },
            {
              id: "receivables_aging",
              title: "Receivables Aging",
              sub: "Driven by invoice due date",
            },
            {
              id: "payables_due",
              title: "Supplier Payables Due",
              sub: "Driven by supplier bill due date",
            },
          ] as const
        ).map((card) => (
          <article
            key={card.id}
            className={`metric selectable-card ${selectedReport === card.id ? "selected-card" : ""}`}
            onClick={() => setSelectedReport(card.id)}
          >
            <div>
              <span>REPORT TYPE</span>
              <span className="metric-icon green">▥</span>
            </div>
            <strong style={{ fontSize: 15, whiteSpace: "normal" }}>{card.title}</strong>
            <small>{card.sub}</small>
          </article>
        ))}
      </section>

      {/* Filters */}
      <section className="filter-bar">
        <label className="form-field"><span>From</span><input type="date" value={exportFrom} max={exportTo} onChange={(event) => setExportFrom(event.target.value)} /></label>
        <label className="form-field"><span>To</span><input type="date" value={exportTo} min={exportFrom} onChange={(event) => setExportTo(event.target.value)} /></label>
        <select
          className="period-select"
          value={filterAccount}
          onChange={(e) => setFilterAccount(e.target.value)}
        >
          <option value="all">All tracking labels</option>
          {state.trackingAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>

        <select
          className="period-select"
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
        >
          <option value="all">All categories</option>
          {state.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </section>

      {/* Report Output Table */}
      <section className="panel transactions">
        <div className="panel-head">
          <div>
            <h2>
              {selectedReport === "income_expense" && "Income & Expense by Category"}
              {selectedReport === "cash_movement" && "Recorded Cash Movement by Tracking Label"}
              {selectedReport === "receivables_aging" && "Customer Receivables Aging Schedule"}
              {selectedReport === "payables_due" && "Supplier Payables & Due Schedule"}
            </h2>
            <p>
              Business: {state.workspace.legalName} · Currency: NGN (₦) · As of{" "}
              {formatDisplayDate(CURRENT_REFERENCE_DATE)}
            </p>
          </div>
        </div>

        <div className="table-scroll">
          {selectedReport === "income_expense" && (
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Posted Entries</th>
                  <th>Recorded Income (NGN)</th>
                  <th>Recorded Expense (NGN)</th>
                  <th>Net Category Movement</th>
                </tr>
              </thead>
              <tbody>
                {categoryBreakdown.map((row) => (
                  <tr key={row.categoryId}>
                    <td className="description">{row.name}</td>
                    <td>{row.count}</td>
                    <td className="positive">+{formatNgn(row.inflowKobo)}</td>
                    <td className="negative">−{formatNgn(row.outflowKobo)}</td>
                    <td>
                      <b>{formatNgn(row.inflowKobo - row.outflowKobo, { showSign: true })}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {selectedReport === "cash_movement" && (
            <table>
              <thead>
                <tr>
                  <th>Tracking Label</th>
                  <th>Opening Recorded Balance</th>
                  <th>Posted Inflows</th>
                  <th>Posted Outflows</th>
                  <th>Closing Recorded Balance</th>
                </tr>
              </thead>
              <tbody>
                {accountBalances.map((item) => (
                  <tr key={item.account.id}>
                    <td className="description">{item.account.name}</td>
                    <td>{formatNgn(item.account.openingBalanceKobo)}</td>
                    <td className="positive">+{formatNgn(item.inflowKobo)}</td>
                    <td className="negative">−{formatNgn(item.outflowKobo)}</td>
                    <td>
                      <b>{formatNgn(item.recordedBalanceKobo)}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {selectedReport === "receivables_aging" && (
            <table>
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Customer</th>
                  <th>Issue Date</th>
                  <th>Due Date</th>
                  <th>Aging Bucket</th>
                  <th>Total Invoiced</th>
                  <th>Outstanding Balance</th>
                </tr>
              </thead>
              <tbody>
                {state.invoices.map((inv) => {
                  const calc = computeInvoiceTotals(inv);
                  if (calc.outstandingKobo <= 0) return null;
                  const cust = state.contacts.find((c) => c.id === inv.customerId);
                  return (
                    <tr key={inv.id}>
                      <td className="description">{inv.invoiceNumber}</td>
                      <td>{cust?.name ?? "Customer"}</td>
                      <td>{formatDisplayDate(inv.issueDate)}</td>
                      <td>{formatDisplayDate(inv.dueDate)}</td>
                      <td>
                        <span className={`tag ${calc.isOverdue ? "coral" : "income"}`}>
                          {calc.isOverdue
                            ? `${calc.daysOverdue} days overdue (1–30d)`
                            : "Current (Not yet due)"}
                        </span>
                      </td>
                      <td>{formatNgn(calc.totalKobo)}</td>
                      <td className="negative">{formatNgn(calc.outstandingKobo)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {selectedReport === "payables_due" && (
            <table>
              <thead>
                <tr>
                  <th>Bill #</th>
                  <th>Supplier</th>
                  <th>Bill Date</th>
                  <th>Due Date</th>
                  <th>Status</th>
                  <th>Outstanding Obligation</th>
                </tr>
              </thead>
              <tbody>
                {state.bills.map((bill) => {
                  const calc = computeBillStatus(bill);
                  const sup = state.contacts.find((c) => c.id === bill.supplierId);
                  return (
                    <tr key={bill.id}>
                      <td className="description">{bill.billNumber}</td>
                      <td>{sup?.name ?? "Supplier"}</td>
                      <td>{formatDisplayDate(bill.billDate)}</td>
                      <td>{formatDisplayDate(bill.dueDate)}</td>
                      <td>
                        <span
                          className={`tag ${
                            calc.effectiveStatus === "paid"
                              ? "income"
                              : calc.effectiveStatus === "due_this_week"
                                ? "amber"
                                : "expense"
                          }`}
                        >
                          {calc.effectiveStatus.replaceAll("_", " ").toUpperCase()}
                        </span>
                      </td>
                      <td>{formatNgn(calc.outstandingKobo)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}

