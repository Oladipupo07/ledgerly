# Decisions and limits

## Applied for this starter

- Responsive web first, per PRD and design specification.
- Cashbook style records, not double-entry accounting, because the PRD explicitly excludes a full double-entry ledger.
- Monetary amounts are integer kobo in domain code; do not use binary floating point for authoritative calculations.
- A posted record must be corrected through an auditable reversal/replacement workflow.
- All business data access must be authorized on the server against the active user's membership.
- Insights are deterministic and must link to the records behind them.

## Still open before real data or launch

- Identity provider and verified email/phone flow.
- Final role matrix. Defer Staff until its promised record/task scope is enforceable. PRD roles and architecture's provisional roles differ.
- Invoice overpayment policy and invoice line rounding rule.
- Reporting date basis for invoices, transactions, and obligations.
- Data retention, recovery objectives, privacy notices, and Nigerian counsel review.
- Hosting region, database, file storage, and notification providers.

The dashboard fixtures are fictional and must not be mistaken for customer records. This starter is not production-ready authentication or persistence.
