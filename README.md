# Ledgerly — Nigeria-First Financial Management Workspace (MVP)

Ledgerly helps Nigerian small and medium-sized businesses understand what happened to their business money, what is due next, and which follow-up actions matter.

Built from:
- **Stage 1**: [Ledgerly Product Vision and PRD](./Ledgerly_Product_Vision_and_PRD.docx)
- **Stage 2**: [System Architecture & Technical Design](./Ledgerly-System-Architecture-Technical-Design.md)
- **Stage 3**: [MVP UI/UX Design Specification](./Ledgerly_UI_UX_Design_Specification.md)

## Getting Started

```bash
npm install
npm run dev
```

Open `http://localhost:3000` in your browser.

### Quality Checks

```bash
npm run typecheck
npm run lint
npm run build
```

## MVP Capabilities Implemented

1. **Overview & Deterministic Money Brief (`FR-11`)**
   - Ranked, rule-based observations (Overdue invoices, Supplier obligations due soon, Low recorded cash threshold / Net movement).
   - Every observation opens an **Evidence & Calculation Modal** linking directly to the contributing records, calculation formula, date window, and data coverage limitation.
   - Four-up KPI summary cards (`Recorded cash`, `Income`, `Expenses`, `To collect`) + 6-month Cash Movement chart with accessible data table toggle.
2. **Transactions & Safe Financial Corrections (`FR-06`, `FR-13`)**
   - Record Income, Expense, Transfer between tracking labels, Refund, or Adjustment in exact integer kobo (`NGN`).
   - Save as Draft or Post with idempotency protection.
   - Posted records are append-only and never destructively overwritten; mistakes are corrected through a **Safe Reversal / Replacement** workflow that logs actor, timestamp, and reason.
3. **4-Step CSV Import Wizard (`FR-07`)**
   - Upload or paste bank/POS CSV statements, select date (`YYYY-MM-DD` / `DD/MM/YYYY`) and decimal conventions, preview all parsed rows, inspect malformed row errors and duplicate candidates, explicitly **Include** or **Skip** rows, and commit with batch provenance.
4. **Invoices, Receipts & Reminders (`FR-08`, `FR-09`)**
   - Create, preview, print/save PDF, and share commercial invoices with line items, discounts, and user-configurable tax fields.
   - Explicitly labelled as an ordinary Ledgerly invoice (not an NRS-validated fiscal e-invoice).
   - Record partial or full customer receipts with overpayment protection and review polite overdue reminder templates.
5. **Customers, Suppliers & Bills (`FR-04`, `FR-10`)**
   - Unified contact directory supporting dual Customer/Supplier roles and non-blocking duplicate contact detection.
   - Supplier bills & obligations grouped by urgency (`OVERDUE`, `DUE THIS WEEK`, `UPCOMING`, `PAID`) with bookkeeping payment recording.
6. **Cash Flow & Reconciled Reports (`FR-11`, `FR-12`)**
   - Retrospective recorded cash position by non-custodial tracking label (`GTBank ••2041`, `POS settlement`, `Cash`) with opening balance provenance.
   - Four management reports (`Income & Expense Summary`, `Cash Movement`, `Receivables Aging`, `Supplier Payables Due`) with CSV export and print/PDF output.
7. **Team Roles, Invitations, Audit Trail & Settings (`FR-01`–`FR-05`, `FR-14`, `FR-15`)**
   - Server-assigned workspace roles (`Owner`, `Admin`, `Bookkeeper`, `External Accountant`) with permission checks on every tenant API request.
   - Append-only Audit History feed, Workspace Settings, Category archiving, Active Session management, and First-Time Setup checklist.

## Backend

The API uses Auth.js OIDC sessions and PostgreSQL. Sign-in requires the identity provider to attest that the account email is verified. The API never accepts a user ID or role from request data. Each tenant request opens one database transaction, checks active membership and capability on the server, sets transaction-local identity/workspace context, and switches to the restricted `ledgerly_app` role. Migration 002 enables and forces PostgreSQL RLS beneath those checks. Posted financial records are immutable; corrections add a reversing entry with a reason and audit event. Financial values are bounded to remain exact in JavaScript and database calculations.

Backend routes cover workspace creation/listing, member invitations/acceptance and role changes, contacts, categories, tracking labels, transaction drafts/postings/reversals, invoices and bookkeeping receipts, supplier bills and recorded payments, audit history, and four reports with CSV export. Receipt and bill-payment routes only record bookkeeping data; they do not initiate transfers or hold funds.

Copy `.env.example` to `.env.local` and set the OIDC values and a random `AUTH_SECRET`. For local development, `docker compose up -d` starts PostgreSQL. Run `npm run db:migrate` to apply the numbered schema migrations. For Supabase, use the transaction-mode pooler URL for `DATABASE_URL`; remote database connections use verified TLS. Use a direct or session connection with migration privileges for `MIGRATION_DATABASE_URL`, because migration 002 creates and grants the restricted application role. Do not run migrations against a production project until the migration SQL and backup plan have been reviewed.

The responsive UI uses authenticated workspace data from these APIs. Configure a valid OIDC provider and database before exercising authenticated routes. Local checks include `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`; the tests cover financial arithmetic, CSV handling, role capabilities, and key migration safeguards but do not replace PostgreSQL integration tests.
