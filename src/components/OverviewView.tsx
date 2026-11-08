"use client";

import React, { useState } from "react";
import {
  WorkspaceState,
  MoneyBriefObservation,
  computeDashboardSummary,
  buildMoneyBrief,
  computeInvoiceTotals,
  computeBillStatus,
  formatDisplayDate,
} from "@/lib/domain";
import { formatNgn } from "@/lib/money";

export type NavTab =
  | "overview"
  | "transactions"
  | "invoices"
  | "customers"
  | "suppliers"
  | "cashflow"
  | "reports"
  | "team"
  | "settings";

interface OverviewViewProps {
  state: WorkspaceState;
  canWriteTransactions: boolean;
  onNavigate: (tab: NavTab, filterHint?: string) => void;
  onOpenNewTransaction: () => void;
  onOpenCsvImport: () => void;
  onDismissObservation: (id: string) => void;
  onMarkObservationReviewed: (id: string) => void;
  onRestoreObservations: () => void;
}

const SIX_MONTH_SERIES = [
  { month: "Jun 2026", incomeKobo: 124_000_00, expenseKobo: 82_000_00 },
  { month: "Jul 2026", incomeKobo: 158_000_00, expenseKobo: 104_000_00 },
  { month: "Aug 2026", incomeKobo: 132_000_00, expenseKobo: 96_000_00 },
  { month: "Sep 2026", incomeKobo: 194_000_00, expenseKobo: 112_000_00 },
  { month: "Oct 2026", incomeKobo: 151_450_00, expenseKobo: 129_970_00 },
  { month: "Nov 2026 (MTD)", incomeKobo: 93_000_00, expenseKobo: 16_850_00 },
];

export function OverviewView({
  state,
  canWriteTransactions,
  onNavigate,
  onOpenNewTransaction,
  onOpenCsvImport,
  onDismissObservation,
  onMarkObservationReviewed,
  onRestoreObservations,
}: OverviewViewProps) {
  const [periodDays, setPeriodDays] = useState<number>(30);
  const [selectedObservation, setSelectedObservation] = useState<MoneyBriefObservation | null>(null);
  const [showChartTable, setShowChartTable] = useState(false);

  const summary = computeDashboardSummary(state, periodDays);
  const allObservations = buildMoneyBrief(state, periodDays);
  const visibleObservations = allObservations.filter((o) => !o.dismissed);

  const contactsById = new Map(state.contacts.map((c) => [c.id, c.name]));
  const categoriesById = new Map(state.categories.map((c) => [c.id, c.name]));
  const accountsById = new Map(state.trackingAccounts.map((a) => [a.id, a.name]));

  const recentPosted = [...state.transactions]
    .filter((t) => t.status === "posted")
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 6);

  const maxChartKobo = Math.max(
    ...SIX_MONTH_SERIES.flatMap((m) => [m.incomeKobo, m.expenseKobo]),
    1,
  );

  return (
    <div className="page-wrap">
      <div className="heading-row">
        <div>
          <p className="eyebrow">FRIDAY, 6 NOVEMBER 2026 · AFRICA/LAGOS (WAT)</p>
          <h1>Good morning, Amina</h1>
          <p className="subheading">
            Here’s what’s happening with <b>{state.workspace.displayName}</b>’s recorded business money.
          </p>
        </div>
        <div className="heading-actions">
          {canWriteTransactions && (
            <>
              <button className="secondary-btn" onClick={onOpenCsvImport}>
                ↑ Import CSV
              </button>
              <button className="primary" onClick={onOpenNewTransaction}>
                ＋ <span>Add transaction</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Data coverage & freshness bar */}
      <div className="coverage" role="status">
        <span className="pulse" />
        <span>
          Your records are updated through <b>{formatDisplayDate(summary.latestRecordDate)}</b> ·{" "}
          <b>{summary.completenessPercent}%</b> of posted entries carry a category & tracking label.
        </span>
        <button
          type="button"
          className="coverage-link-btn"
          onClick={() => onNavigate("transactions")}
        >
          Inspect source records →
        </button>
      </div>

      {/* Signature Experience: Deterministic Money Brief */}
      <section className="brief" aria-labelledby="brief-title">
        <div className="section-head">
          <div>
            <div className="brief-label">
              <span>✳</span> YOUR MONEY BRIEF · DETERMINISTIC RULES
            </div>
            <h2 id="brief-title">A few things to look at</h2>
          </div>
          <div className="inline-controls">
            {state.dismissedObservationIds.length > 0 && (
              <button type="button" className="text-btn" onClick={onRestoreObservations}>
                Restore {state.dismissedObservationIds.length} dismissed
              </button>
            )}
            <label className="sr-only" htmlFor="brief-period">
              Reporting period
            </label>
            <select
              id="brief-period"
              className="period-select"
              value={periodDays}
              onChange={(e) => setPeriodDays(Number(e.target.value))}
            >
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
          </div>
        </div>

        {visibleObservations.length === 0 ? (
          <div className="empty-card">
            <p>All observations for this period have been dismissed or reviewed.</p>
            {state.dismissedObservationIds.length > 0 && (
              <button className="secondary-btn" onClick={onRestoreObservations}>
                Show all observations
              </button>
            )}
          </div>
        ) : (
          <div className="brief-grid">
            {visibleObservations.map((item) => (
              <article
                className={`insight ${item.reviewedAt ? "reviewed" : ""}`}
                key={item.id}
              >
                <div className={`insight-mark ${item.tone}`} aria-hidden="true">
                  {item.mark}
                </div>
                <div className="insight-copy">
                  <div className="insight-title-row">
                    <h3>{item.title}</h3>
                    {item.reviewedAt && <span className="pill-badge green">Reviewed</span>}
                  </div>
                  <p>{item.whyItAppears}</p>
                  <div className="insight-amount-row">
                    <b>{formatNgn(item.amountKobo)}</b>
                    <span className="record-count-tag">
                      {item.supportingRecordIds.length} record(s)
                    </span>
                  </div>
                  <div className="insight-actions">
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => setSelectedObservation(item)}
                    >
                      See evidence & why →
                    </button>
                    {!item.reviewedAt && (
                      <button
                        type="button"
                        className="subtle-btn"
                        onClick={() => onMarkObservationReviewed(item.id)}
                      >
                        Mark reviewed
                      </button>
                    )}
                    <button
                      type="button"
                      className="subtle-btn"
                      aria-label={`Dismiss ${item.title}`}
                      onClick={() => onDismissObservation(item.id)}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
        <p className="brief-foot">
          Every Money Brief card is calculated from entries recorded or imported by your team. It does not reflect unrecorded cash or live bank feeds.
        </p>
      </section>

      {/* Four-up KPI Summary Cards */}
      <section className="metrics" aria-label="Business summaries">
        <article className="metric">
          <div>
            <span>Recorded cash</span>
            <span className="metric-icon green">↗</span>
          </div>
          <strong>{formatNgn(summary.recordedCashKobo)}</strong>
          <small>
            Across {state.trackingAccounts.filter((a) => !a.archived).length} tracking labels (not live bank balance)
          </small>
          <button
            type="button"
            className="metric-link-btn"
            onClick={() => onNavigate("cashflow")}
          >
            See cash movement →
          </button>
        </article>

        <article className="metric">
          <div>
            <span>Income</span>
            <span className="metric-icon">＋</span>
          </div>
          <strong>{formatNgn(summary.incomeKobo)}</strong>
          <small>Last {periodDays} days · Posted inflows</small>
          <button
            type="button"
            className="metric-link-btn"
            onClick={() => onNavigate("transactions", "income")}
          >
            View income records →
          </button>
        </article>

        <article className="metric">
          <div>
            <span>Expenses</span>
            <span className="metric-icon coral">↘</span>
          </div>
          <strong>{formatNgn(summary.expenseKobo)}</strong>
          <small>Last {periodDays} days · Posted outflows</small>
          <button
            type="button"
            className="metric-link-btn"
            onClick={() => onNavigate("transactions", "expense")}
          >
            View expense records →
          </button>
        </article>

        <article className="metric">
          <div>
            <span>To collect</span>
            <span className="metric-icon amber">◷</span>
          </div>
          <strong>{formatNgn(summary.toCollectKobo)}</strong>
          <small>
            Across {summary.openInvoiceCount} open invoice(s) ({summary.overdueInvoices.length} overdue)
          </small>
          <button
            type="button"
            className="metric-link-btn"
            onClick={() => onNavigate("invoices")}
          >
            View open invoices →
          </button>
        </article>
      </section>

      {/* Lower Grid: Cash Movement & Attention Queue */}
      <section className="lower-grid">
        <article className="panel movement">
          <div className="panel-head">
            <div>
              <h2>Cash movement</h2>
              <p>Recorded inflows and outflows over 6 months (NGN)</p>
            </div>
            <button
              type="button"
              className="period-select"
              onClick={() => setShowChartTable((v) => !v)}
            >
              {showChartTable ? "Show bar chart" : "Accessible data table"}
            </button>
          </div>

          {showChartTable ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Recorded Income</th>
                    <th>Recorded Expenses</th>
                    <th>Net Movement</th>
                  </tr>
                </thead>
                <tbody>
                  {SIX_MONTH_SERIES.map((row) => (
                    <tr key={row.month}>
                      <td className="description">{row.month}</td>
                      <td className="positive">+{formatNgn(row.incomeKobo)}</td>
                      <td className="negative">−{formatNgn(row.expenseKobo)}</td>
                      <td>
                        <b>{formatNgn(row.incomeKobo - row.expenseKobo, { showSign: true })}</b>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <>
              <div className="chart" role="img" aria-label="Six month income and expense bar chart">
                <div className="axis">
                  <span>₦2.0M</span>
                  <span>₦1.5M</span>
                  <span>₦1.0M</span>
                  <span>₦500k</span>
                </div>
                <div className="bars">
                  {SIX_MONTH_SERIES.map((item) => {
                    const incPct = Math.round((item.incomeKobo / maxChartKobo) * 92);
                    const expPct = Math.round((item.expenseKobo / maxChartKobo) * 92);
                    return (
                      <div className="bar-group" key={item.month}>
                        <div className="bar-pair">
                          <i
                            style={{ height: `${incPct}%` }}
                            title={`${item.month} Income: ${formatNgn(item.incomeKobo)}`}
                          />
                          <i
                            style={{ height: `${expPct}%` }}
                            title={`${item.month} Expenses: ${formatNgn(item.expenseKobo)}`}
                          />
                        </div>
                        <small>{item.month.slice(0, 3)}</small>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="legend">
                <span>
                  <i /> Recorded Income
                </span>
                <span>
                  <i /> Recorded Expenses
                </span>
                <small>Currency: NGN (₦) · Based on posted entries</small>
              </div>
            </>
          )}
        </article>

        <article className="panel attention">
          <div className="panel-head">
            <div>
              <h2>Needs your attention</h2>
              <p>Overdue receivables and upcoming obligations</p>
            </div>
          </div>

          {summary.overdueInvoices.map(({ invoice, calc }) => (
            <button
              type="button"
              key={invoice.id}
              className="attention-row-btn"
              onClick={() => onNavigate("invoices")}
            >
              <span className="attention-icon amber">↗</span>
              <span>
                <b>Invoice overdue ({calc.daysOverdue} days)</b>
                <small>
                  {invoice.invoiceNumber} · {contactsById.get(invoice.customerId) ?? "Customer"} · Due{" "}
                  {formatDisplayDate(invoice.dueDate)}
                </small>
              </span>
              <strong>{formatNgn(calc.outstandingKobo)}</strong>
            </button>
          ))}

          {summary.dueSoonOrOverdueBills.map(({ bill, calc }) => (
            <button
              type="button"
              key={bill.id}
              className="attention-row-btn"
              onClick={() => onNavigate("suppliers")}
            >
              <span className="attention-icon blue">◷</span>
              <span>
                <b>
                  {calc.daysUntilDue < 0
                    ? `Supplier bill overdue (${Math.abs(calc.daysUntilDue)}d)`
                    : `Supplier bill due in ${calc.daysUntilDue} day(s)`}
                </b>
                <small>
                  {bill.billNumber} · {contactsById.get(bill.supplierId) ?? "Supplier"} · Due{" "}
                  {formatDisplayDate(bill.dueDate)}
                </small>
              </span>
              <strong>{formatNgn(calc.outstandingKobo)}</strong>
            </button>
          ))}

          <div className="attention-foot">
            <button
              type="button"
              className="metric-link-btn"
              onClick={() => onNavigate("invoices")}
            >
              Manage invoices & reminders →
            </button>
          </div>
        </article>
      </section>

      {/* Recent Transactions Table */}
      <section className="panel transactions">
        <div className="panel-head">
          <div>
            <h2>Recent transactions</h2>
            <p>Latest posted records across your tracking labels</p>
          </div>
          <button
            type="button"
            className="metric-link-btn"
            onClick={() => onNavigate("transactions")}
          >
            View all ({state.transactions.length}) →
          </button>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Category</th>
                <th>Tracking Label</th>
                <th>Type</th>
                <th>Amount (NGN)</th>
              </tr>
            </thead>
            <tbody>
              {recentPosted.map((tx) => (
                <tr key={tx.id}>
                  <td>{formatDisplayDate(tx.date)}</td>
                  <td className="description">
                    {tx.description}
                    {tx.reference && <span className="sub-meta">Ref: {tx.reference}</span>}
                  </td>
                  <td>{categoriesById.get(tx.categoryId) ?? "Uncategorized"}</td>
                  <td>{accountsById.get(tx.trackingAccountId) ?? "—"}</td>
                  <td>
                    <span className={`tag ${tx.direction === "inflow" ? "income" : "expense"}`}>
                      {tx.type.toUpperCase()}
                    </span>
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
      </section>

      {/* Evidence Drill-down Modal for Money Brief Observation */}
      {selectedObservation && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="evidence-modal-title"
        >
          <div className="modal-card">
            <div className="modal-header">
              <div>
                <span className="brief-label">✳ MONEY BRIEF EVIDENCE & CALCULATION</span>
                <h2 id="evidence-modal-title">{selectedObservation.title}</h2>
              </div>
              <button
                type="button"
                className="close-btn"
                onClick={() => setSelectedObservation(null)}
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              <div className="evidence-summary-box">
                <div>
                  <small>Observation Total</small>
                  <strong>{formatNgn(selectedObservation.amountKobo)}</strong>
                </div>
                <div>
                  <small>Window</small>
                  <b>{selectedObservation.periodWindow}</b>
                </div>
                <div>
                  <small>Supporting Records</small>
                  <b>{selectedObservation.supportingRecordIds.length} item(s)</b>
                </div>
              </div>

              <div className="field-block">
                <h4>How this was calculated</h4>
                <p>{selectedObservation.calculationSummary}</p>
              </div>

              <div className="field-block">
                <h4>Data coverage & limitation</h4>
                <p className="warning-note">{selectedObservation.limitationNote}</p>
              </div>

              <div className="field-block">
                <h4>Contributing source records</h4>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Ref / Date</th>
                        <th>Party / Description</th>
                        <th>Status</th>
                        <th>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedObservation.supportingEntityKind === "invoice" &&
                        state.invoices
                          .filter((inv) =>
                            selectedObservation.supportingRecordIds.includes(inv.id),
                          )
                          .map((inv) => {
                            const calc = computeInvoiceTotals(inv);
                            return (
                              <tr key={inv.id}>
                                <td>
                                  <b>{inv.invoiceNumber}</b> · Due {formatDisplayDate(inv.dueDate)}
                                </td>
                                <td>{contactsById.get(inv.customerId) ?? "Customer"}</td>
                                <td>
                                  <span className="tag amber">{calc.daysOverdue}d overdue</span>
                                </td>
                                <td>{formatNgn(calc.outstandingKobo)}</td>
                              </tr>
                            );
                          })}

                      {selectedObservation.supportingEntityKind === "bill" &&
                        state.bills
                          .filter((b) => selectedObservation.supportingRecordIds.includes(b.id))
                          .map((b) => {
                            const calc = computeBillStatus(b);
                            return (
                              <tr key={b.id}>
                                <td>
                                  <b>{b.billNumber}</b> · Due {formatDisplayDate(b.dueDate)}
                                </td>
                                <td>{contactsById.get(b.supplierId) ?? "Supplier"}</td>
                                <td>
                                  <span className="tag expense">{calc.effectiveStatus}</span>
                                </td>
                                <td>{formatNgn(calc.outstandingKobo)}</td>
                              </tr>
                            );
                          })}

                      {selectedObservation.supportingEntityKind === "transaction" &&
                        state.transactions
                          .filter((t) => selectedObservation.supportingRecordIds.includes(t.id))
                          .slice(0, 6)
                          .map((t) => (
                            <tr key={t.id}>
                              <td>{formatDisplayDate(t.date)}</td>
                              <td>{t.description}</td>
                              <td>
                                <span
                                  className={`tag ${t.direction === "inflow" ? "income" : "expense"}`}
                                >
                                  {t.type}
                                </span>
                              </td>
                              <td className={t.direction === "inflow" ? "positive" : "negative"}>
                                {t.direction === "inflow" ? "+" : "−"}
                                {formatNgn(t.amountKobo)}
                              </td>
                            </tr>
                          ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="secondary-btn"
                onClick={() => {
                  onMarkObservationReviewed(selectedObservation.id);
                  setSelectedObservation(null);
                }}
              >
                ✓ Mark as reviewed
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  const target = selectedObservation.targetTab;
                  setSelectedObservation(null);
                  onNavigate(target);
                }}
              >
                {selectedObservation.actionLabel} →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

