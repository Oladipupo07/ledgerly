# Ledgerly MVP UI/UX Design Specification

**Stage:** 3 — UI/UX design  
**Status:** Handoff specification; final product decisions remain subject to pilot validation  
**Product:** Nigeria-first financial management workspace for owner-led SMEs  
**Date:** 5 November 2026  
**Design source:** [Editable Figma design](https://www.figma.com/design/Iua3Ai7h1QltNOb1YkA66p)

## 1. Purpose and source of truth

This specification defines the MVP interaction model, visual system, web and mobile web information architecture, important journeys, screen requirements, states and development handoff. It is based on the completed Ledgerly PRD and Stage 2 System Architecture and Technical Design. The design is for a responsive web application; it does not authorize application coding or implementation.

Ledgerly helps Nigerian business owners understand what happened to business money, what is due next, and which follow-up action matters. The signature MVP experience is a transparent, evidence-linked **Money Brief** built from user-entered and imported records. The primary persona is an owner-led service or trade business with one location and 1–20 staff; “all SMBs” remains the long-term audience, not a promise that every industry workflow is optimized at launch.

The UI represents money records, not bank-held balances. Tracking accounts are labels the business maintains. Invoice payment instructions are supplied by the business. A “paid” state must be explicitly confirmed by a user or future verified integration. No screen implies Ledgerly holds funds, initiates payment, provides lending, offers statutory accounting, or certifies an NRS e-invoice.

## 2. Product and design principles

1. **Clarity before sophistication.** Explain each amount in ordinary business language; expose date range, currency, coverage and calculation path.
2. **Evidence is one step away.** Every total, insight and report can open the contributing records and their source/import batch.
3. **Safe financial correction.** Preserve history. Posted entries are corrected through a traceable reversal or correction workflow; confirmation shows the impact before committing.
4. **Owner control.** The business can export records, choose who sees them, correct mistakes and understand what each member can do.
5. **Nigeria by default.** NGN and Africa/Lagos are the starting defaults, with local business vocabulary, practical mobile layouts and low-bandwidth behavior.
6. **Resilient to incomplete records.** Empty states guide the next useful step. Partial data is labelled; missing records are not silently treated as zero.
7. **Accessible and calm.** Strong contrast, plain labels, predictable actions and no color-only status communication. Avoid alarm-heavy dashboards.
8. **MVP first.** Deliver the weekly money review loop before advanced forecasts, automation, integrations or operational suites.

## 3. MVP scope and deferred screens

### MVP screens

- Account access: sign up, verification, sign in, recovery, session management.
- First business setup: business profile, reporting defaults, optional opening recorded balances, categories/tracking labels, invite member, first entry/import.
- Overview and Money Brief.
- Transactions: list, details, create/edit draft, post, reverse/correct, CSV import and import batch review.
- Invoices and receipts: list, create/preview/share/download, status, partial/full receipts and reminder review.
- Customers and suppliers: list, create/edit, profile, activity and balance/aging context.
- Supplier bills / obligations: list, create/edit, record status.
- Cash movement and receivables/payables summaries.
- Reports and CSV/PDF exports.
- Team and roles, audit history, workspace settings, notification preferences, help/feedback.

### Later phase; exclude from MVP navigation or mark as unavailable

- Native iOS/Android apps, offline ledger writes, bank feeds, open banking and payment initiation.
- Wallets, stored value, custody, transfers, lending, tax filing or certified fiscal e-invoicing.
- AI assistant, generative financial advice, predictive forecasts, cash-flow simulation and autonomous actions.
- Multi-currency accounting, branches, multi-entity consolidation, payroll, inventory, ERP, advanced accounting ledgers.
- Public self-service subscription billing; pilot entitlements can be shown in settings if needed.

The MVP **Money Brief** uses deterministic rules only: overdue invoices, obligations due soon, low recorded cash relative to a user-set threshold, missing data, and notable period changes. “Unusual” movements are indicators based on visible comparison logic, not predictions. Every insight includes a period, source and limitation.

## 4. Brand direction and visual identity

**Positioning:** a dependable money workspace for Nigerian business operators, combining the warmth of a useful business tool with the restraint of financial software.

- **Wordmark:** lowercase “ledgerly” in a clean sans serif; a compact “L” or ledger-column mark can accompany it. Avoid bank seals, currency stacks, coins, shields and national flag motifs.
- **Visual metaphor:** an open ledger becoming a clear path from activity to action. Use fine rules, aligned columns and restrained green highlights.
- **Photography/illustration:** not needed inside core financial workflows. Use simple line illustrations for first-run empty states; avoid generic stock-office imagery.
- **Tone:** concise, respectful, specific and non-judgmental. Say “3 rows need review” instead of “Import failed.” Say “Recorded cash” instead of “Your bank balance.”
- **Light theme:** MVP default. Dark theme is a later preference only if supported consistently across data-dense views.

## 5. Design tokens

| Token | Value | Use |
|---|---|---|
| `brand.ink` | `#11273B` | Primary text, navigation canvas |
| `brand.ledger` | `#127A59` | Primary actions, positive movement, selected links |
| `brand.mint` | `#E7F5EE` | Money Brief / positive contextual surface |
| `surface.canvas` | `#F7F9FA` | App background |
| `surface.card` | `#FFFFFF` | Cards, tables, modal content |
| `text.primary` | `#172633` | Main text |
| `text.secondary` | `#61737F` | Supporting labels, metadata |
| `border.default` | `#E0E8EB` | Dividers, input outlines |
| `status.success` | `#127A59` | Success; pair with text/icon |
| `status.warning` | `#B57217` | Due soon, needs review |
| `status.error` | `#BA3B38` | Failed, overdue, destructive warning |
| `status.info` | `#3164AD` | Informational notices |

**Typography:** Inter. Use 28/36 px semibold for page titles; 20/28 for primary section headings; 16/24 for card headings; 14/21 body; 12/18 metadata. Large financial values 24–28 px semibold, table amounts 13–14 px semibold, tabular numerals enabled where possible. Keep long explanatory content at 14–16 px. Avoid dense all-caps labels.

**Spacing scale:** 4, 8, 12, 16, 24, 32, 40, 48 px. Standard card padding 20–24 px desktop and 16 px mobile. Default card radius 12 px, input/button radius 8 px, pill radius full. Use borders as the primary separation; reserve shadows for menus/dialogs.

**Controls:** desktop controls 40–44 px high; mobile touch targets at least 48×48 px. Focus ring 2 px with a 2 px offset, visible on all interactive elements. Disabled controls retain readable text and explain why when permission or prerequisites prevent action.

## 6. Responsive behavior

| Range | Layout |
|---|---|
| `< 600 px` | Mobile web: single column, 16 px page gutters, sticky top bar, bottom navigation (Home, Transactions, Invoices, More), full-screen create/edit flows, filter sheet, cards instead of wide tables. |
| `600–899 px` | Compact tablet: collapsed rail or drawer, two-column cards when content permits, tables retain key columns and allow horizontal scrolling with pinned description/amount where feasible. |
| `900–1279 px` | Desktop compact: 200 px collapsible sidebar, two-column dashboard, dense lists with reduced optional columns. |
| `≥ 1280 px` | Full desktop: 228–240 px sidebar, 24–32 px content gutter, dashboard four-up KPI cards, full table columns. Maximum main content width around 1440 px. |

Do not use mobile breakpoint as a reason to hide permissions, provenance, currency, date or status. Use progressive disclosure and a record detail sheet instead.

## 7. Navigation and information architecture

### Desktop primary navigation

1. Overview
2. Transactions
3. Invoices
4. Customers
5. Suppliers
6. Cash flow
7. Reports
8. Team & roles (permission-gated)
9. Settings (permission-gated)

Global header: business switcher, breadcrumb/page title context, global search, notifications, help, profile/session. “Add transaction” is a prominent contextual shortcut on Overview and Transactions. “Create invoice” is prominent on Invoices. Avoid a dashboard header cluttered with every action.

### Mobile primary navigation

Home, Transactions, Invoices and More. “More” contains Customers, Suppliers, Cash flow, Reports, Team (if allowed), Settings and Help. Expose a compact add button from Home and Transactions; provide an action sheet for transaction type.

### Screen access map

| Area | List/detail/create pattern | Permission note |
|---|---|---|
| Overview / Money Brief | summary → evidence list → source record | Owner/Admin/Bookkeeper; Staff receives only allowed scope; Accountant view-only. |
| Transactions | filterable list → record detail → draft/edit/post/reverse | Staff is scoped; Accountant read-only; posting/correction requires role permission. |
| Invoices | list → invoice detail → create/preview/share/record receipt | Create/send and receipt recording follow assigned role. |
| Contacts | customer/supplier list → profile → activity | Only authorized workspace members. One contact may serve both roles. |
| Bills | obligations list → bill detail → record status | Payment status is bookkeeping only. |
| Cash flow | recorded movement → account/category breakdown → source records | Label all balances as recorded. |
| Reports | report selection → filters → totals/drill-down → export | Export permission is enforced server-side. |
| Team & audit | members/invites/roles → role details; audit feed | Owner/Admin management; read scope follows PRD. |
| Settings | business, financial year, categories/accounts, notifications, sessions, data export | Sensitive owner-only changes require re-authentication as defined by architecture. |

## 8. Core journeys

### A. New owner reaches first value

1. Create account using verified email or phone OTP; explain where verification code is sent and allow resend with cooldown.
2. Create workspace: legal/display name, business type, location, financial-year start, timezone defaulting to Africa/Lagos, currency NGN; tax identifier optional and purpose explained.
3. Show short progress steps; let owner skip nonessential category setup and invitations.
4. Offer “Add a few records” or “Import a CSV.” Explain that tracking labels are not connected accounts.
5. For CSV: upload → choose date/amount conventions → map columns → preview all rows with row-level errors/duplicate flags → resolve or explicitly skip → confirm commit.
6. Dashboard explains whether there is enough data for the Money Brief. Avoid false empty zeros; show “No records yet.”

### B. Owner weekly review

1. Overview identifies reporting period, last record/import date and coverage caveat.
2. Owner reviews Money Brief cards, each with reason, amount, calculation window and evidence count.
3. Open a card to see supporting records; filter/sort and open record detail.
4. Correct classification or mark reviewed/dismiss with an optional reason; dismissal does not alter financial data.
5. Review due receivables and supplier obligations; open the invoice/bill and take a follow-up action.
6. Generate a report with explicit period/filter/currency and export timestamp.

### C. Record an income or expense

1. Choose Income, Expense, Transfer, Refund or Adjustment; a short explanation clarifies transfer is an internal bookkeeping movement.
2. Enter amount, date, category, tracking label, optional contact, reference, note and optional attachment.
3. Draft preview summarizes the classification and effect on recorded cash; confirmation before posting.
4. Successful post returns a stable receipt/detail screen and source links. Retry is idempotent and does not create a duplicate.
5. Correction shows existing entry, reason, proposed reversal/replacement and net effect before confirmation.

### D. Create invoice and record a receipt

1. Choose customer or create one inline; enter invoice number (suggested, editable subject to uniqueness), dates, line items, discount, optional configured tax fields, terms and business-supplied payment instructions.
2. Review preview; label as an ordinary Ledgerly invoice, not NRS-validated or fiscally certified.
3. Share/download only after explicit user confirmation. If email is offered, preview recipients and message first.
4. Record partial or full receipt with date, amount, reference and source; user confirmation is explicit. Ledgerly does not initiate payment.
5. Detail shows original total, receipts, outstanding amount, due/overdue state and full history.

### E. Invite a bookkeeper

1. Owner/Admin selects invitee and role; summary states what this role can and cannot do.
2. Invitee receives an expiring invite; pending, accepted, expired and revoked states are visible.
3. Role changes/deactivation show impact and require confirmation; access revokes promptly and audit entry is created.

## 9. Screen specifications

Each row names MVP screens; later screens are not launch commitments. Desktop and mobile states inherit the shared components and state model below.

### 9.1 Authentication (MVP)

- **Sign up / sign in:** single focused card; email or phone OTP according to selected auth provider; display destination, resend timing, change destination, verified state. Do not ask for business data before account verification.
- **Recovery:** clear account recovery route, neutral message that does not reveal whether an account exists, rate-limit feedback and support path.
- **Sessions:** list device/browser, approximate last active, current-session marker, revoke-other-sessions action; re-authenticate before sensitive security changes.
- **Validation:** required identifier; valid phone/email format; OTP length and expiry; never clear valid identifier after code error. Errors are inline plus a concise summary.

### 9.2 Onboarding and organisation setup (MVP)

- Stepper: Account → Business → Financial defaults → First records → Invite team (skippable) → Ready.
- Business fields: legal name, display name, type, state/city, optional tax identifier and explanation.
- Financial defaults: base currency NGN; Africa/Lagos timezone; financial-year start; first report range. Any alternative timezone/date choice is explicit.
- Optional opening recorded balance asks date, tracking label, amount and “provided by you” provenance; never word as a verified bank balance.
- Setup progress is saveable; leaving warns only when unsaved input would be lost. Completion summary links to next useful action.
- **Empty state:** “Add your first income or expense” and “Import a CSV”; sample CSV template clearly marked as sample.

### 9.3 Overview and Money Brief (MVP)

- Header: personalized greeting, workspace, reporting date range and primary Add transaction action.
- Money Brief: up to three ranked observations; each states “why this appears,” date window, supporting record count, freshness and action. Data completeness label appears when sources are missing.
- KPIs: Recorded cash, Income, Expenses, To collect. Each KPI opens a filtered source view. Specify comparison period where shown. Recorded cash is a calculation from records, not a connected bank balance.
- Cash movement visualization: income/outflow by month; direct labels and accessible data table alternative; currency and period visible.
- Attention list: overdue invoice, upcoming supplier obligation, unresolved import. Show business name/reference, amount, age/due date and next action.
- Recent records table: date, description, category, tracking label, status, amount; filters/search available on “View all.”
- **First-use empty:** onboarding checklist and paths to add/import; no invented zero-value insights.
- **Partial-data:** “Based on records through [date]. Add missing records for a more complete view.”

### 9.4 Transactions (MVP)

- List toolbar: search description/reference/contact; period, type, category, tracking label, status, source/import batch filters; import and export controls according to role.
- Table: date, description, contact, category, tracking label, source/status, amount. Amounts align right and carry sign and color plus accessible text (Income/Expense). Sort is stable; paginated results announce range/count.
- Detail: amount and NGN, posted/draft state, date, type, category, label, contact, source and import batch, attachment, creator/time, notes and audit history.
- Create flow: progressive sections; amount always visible; category/date required; unknown/uncategorized is allowed only when PRD rules permit and is surfaced in completeness indicators. Save draft and post are distinct actions.
- Posted records cannot be overwritten or deleted. “Correct record” displays a reason field and reversal/replacement preview. Only allowed roles can confirm.
- CSV import: choose file → convention & mapping → full preview → resolve errors/duplicates → commit → results. Never silently drop rows; provide row number, issue, suggested fix and explicit Skip/Include decision. Import log retains provenance.
- **Import errors:** file type/size, encoding, columns missing, malformed row, duplicate candidate, partial commit failure; state whether nothing, some, or all rows were committed and how to safely retry.

### 9.5 Invoices, receipts and receivables (MVP)

- Invoice list: number, customer, issue/due date, total, outstanding, status and last activity. Filters: overdue/open/paid/draft/cancelled, customer, period.
- Invoice detail: business header, customer, lines, subtotal/discount/configured tax fields, total, payment instructions, receipts, outstanding and status timeline. PDF preview must preserve legal labels and locale formatting.
- Create/edit draft: unique invoice number, issue/due date, customer, description, quantity, unit amount, optional discount and user-configured tax field. Explain that tax fields are records and not tax advice.
- Share/download dialog: preview recipient/channel and invoice; confirm before external send. No claim of delivery/payment unless delivery provider or user confirmation supports it.
- Receipt entry: amount cannot exceed outstanding unless explicit overpayment policy is later approved; partial payments supported; record date/reference/method label. User must confirm payment received.
- Reminder template: editable, review-before-send; no sensitive value in notification subject/lock screen by default.
- **States:** Draft, Sent/Shared (user action), Partially paid, Paid (confirmed), Overdue (derived from due date and outstanding amount), Disputed, Cancelled. Show source for each transition.

### 9.6 Customers (MVP)

- List: name, contact, open invoices, outstanding amount and last activity. Search normalized name/email/phone; duplicate suggestion is non-blocking and requires user confirmation.
- Profile: contact details, customer/supplier role badges (one contact can be both), notes, invoices, receipts, transaction activity, outstanding/aging and audit metadata by permission.
- Create/edit form: name required; contact and business identifier optional; status, notes; do not require sensitive customer data without product need.
- Empty state offers create customer and contextual create invoice.

### 9.7 Suppliers and bills (MVP)

- Supplier list: supplier, upcoming/overdue bill total, next due date and last activity.
- Supplier detail: contact info, bills, associated expenses, recorded payments/status and audit trail.
- Bill form: supplier, bill date, due date, amount, category, reference, optional attachment/notes. Payment status is a bookkeeping record; “Pay supplier” is not an action label.
- Due list groups Overdue, Due this week and Later; show date and amount. Export respects role and filters.

### 9.8 Cash flow (MVP retrospective; forecast later)

- Recorded cash position by tracking label, movement timeline and reconciled income/outflow by selected period.
- Explain included entry types and opening-balance provenance; data “as of” timestamp visible.
- No connected-bank wording or live-balance indicator. Future forecast area should be absent or explicitly marked “Planned” outside MVP if a roadmap teaser is desired.

### 9.9 Reports and exports (MVP)

- MVP report cards: Income & expense summary, cash movement, receivables aging and payables due.
- Report builder: period, category, contact and tracking label filters; selected filters remain visible in export.
- Summary totals reconcile to source list; selecting a value opens matching records. Clearly state whether invoice, transaction or due date drives each report.
- Export review: format CSV/PDF, business, period, currency, filters, generation timestamp, record count and permission check. Queue long exports with progress and safe re-download behavior.
- Do not call general management reports statutory accounts or tax returns.

### 9.10 Team, roles and audit (MVP)

| Role | View | Create/edit | Sensitive actions |
|---|---|---|---|
| Owner | Full workspace | Full | Manage org and members, exports, corrections, settings, deletion requests |
| Admin | Full | Full | Manage members/settings within limits; ownership/billing remains owner-controlled if configured |
| Bookkeeper | Dashboard/Money Brief, records and reports | Transactions, invoices, receipts, bills, imports | Cannot manage membership; corrections are limited/request-based per policy |
| Staff | Only assigned/allowed operational scope | Scoped transactions/invoices/receipts | No business-wide reports, exports, roles or posted-record correction |
| Accountant | Read-only records, reports and audit scope | None by default | Export only when explicitly granted |

“Scoped” access must only be presented if the underlying permission restriction exists. Do not expose a role switch that implies unimplemented fine-grained scope. Member list shows role, invite state, last active and actions. Audit list filters actor, action, record type and date; hide fields the viewer cannot read.

### 9.11 Settings (MVP)

- Business profile: name, type, location, timezone, currency (NGN default), financial year and optional tax identifier.
- Categories and tracking labels: create, rename, archive; referenced values cannot be silently deleted. Tracking account helper text: “A label for your records; not connected to a bank.”
- Notifications: channel/frequency preferences; sensitive amounts excluded from subject/lock-screen notifications by default.
- Security: sessions, recovery, MFA status (when available), member security events.
- Data: export request and account deletion/contact support path; clarify processing status and any retention constraints without overpromising deletion timing.
- Help & feedback: contextual guidance, report a problem and product feedback.
- Pilot plan: if displayed, label pilot access clearly; no fabricated pricing or self-serve payment assumptions.

### 9.12 AI assistant and later capabilities

AI assistant, personalized forecasting, scenario planning, bank connections, subscription checkout and native mobile apps are **not MVP screens**. The later experience requires explicit data quality gates, consent and provider review, evidence links, confidence/assumption disclosure, human review and tenant separation. An assistant must not mutate financial records or make autonomous payment/tax/lending decisions.

## 10. Shared components

- App shell: business switcher, sidebar/drawer, header, responsive bottom nav, breadcrumbs, global search, profile menu.
- Buttons: primary, secondary, tertiary, destructive; clear pending/disabled states and prevent duplicate submit.
- Form fields: label, required/optional hint, help text, inline error, input prefix/suffix, character/amount guidance.
- Money input: NGN symbol/code visible; grouping on blur; exact value on edit; never parse with binary float assumptions; negative entry type is selected explicitly rather than hidden sign behavior.
- Date input: locale preview and timezone note where meaningful; ISO storage is not exposed to the customer.
- Status badge: text + icon/color; distinguish lifecycle status (Draft/Posted) from due status (Overdue).
- Data table: search, filters, sort, pagination, responsive compact mode, column controls only if needed, empty and error states, accessible row focus.
- Money card: label, amount, period, comparison/source note and drill-down affordance.
- Money Brief card: title, why, period, value, record count, data freshness, limitation, action and dismiss/review controls.
- Dialog/sheet: destructive or consequential confirmation with explicit impact and reason where required.
- Toast/banner: success is non-blocking; errors remain until actionable or dismissed.
- Import wizard: stepper, file summary, column mapping, row status, duplicate review, commit summary, downloadable error report.
- Activity timeline: actor, time, action and changed field summary; no secret values.
- Skeleton: match actual content structure; never show shimmering money amounts that could be mistaken for live totals.

## 11. Financial formatting, validation and integrity

- Default display: `₦2,845,300.00` where fractional kobo are relevant; omit `.00` for ordinary whole-naira display only when the surface consistently communicates precision. Use `NGN` in exports and explicit currency in cross-context reports. Align amounts right and use tabular numerals.
- Locale: `en-NG` conventions and Africa/Lagos timezone by default. Dates in UI use an unambiguous form such as `30 Oct 2026`; exported machine-readable dates use ISO 8601/date format documented in the export.
- Store/use exact decimal or integer minor-unit arithmetic per architecture choice; UI never calculates authoritative totals client-side. Round only using documented domain policy.
- Validate required fields on blur and submit; preserve valid input on error. Error text names the field and fix, not only “invalid.”
- Amount: positive value with up to approved currency precision; explicit type controls direction. Reject malformed/overflow values, show formatted preview and currency.
- Dates: valid calendar date; due date policy explained; future/past restrictions only when confirmed by product rules.
- Invoice: unique number per business; at least one line; quantity and unit amount valid; due date not before issue date unless permitted with visible warning; tax fields are user-configured.
- Receipt: positive amount; duplicate/reference warning; overpayment behavior unresolved and must be decided before build. Partial payments supported.
- CSV: encode/display supported date and decimal convention before import; show every rejected/skipped row and duplicate candidate; commit is explicit and retry-safe.
- Concurrent edit: draft conflict message offers reload/compare; posted record remains stable.
- Financial action confirmation includes tenant/business, amount, date, resulting state and correction effect.

## 12. States and feedback patterns

| State | Pattern |
|---|---|
| First-use empty | Brief explanation + single next action + alternative import path. Do not show zeros as if records were present. |
| Filtered empty | “No transactions match these filters” + clear filters; preserve the entered filters until changed. |
| Loading | Structure-matched skeleton; announce busy state to assistive tech; keep stable layout. |
| Slow/offline/interrupted | “Still saving” or “Connection interrupted”; preserve draft locally only where architecture permits and distinguish unsynced from saved. Retry is safe/idempotent. No promise of full offline ledger. |
| Success | Confirmation with stable record reference and next action; toast plus updated status. For post/import, show result count and link to source/batch. |
| Validation error | Inline field message and error summary at form top; move focus to summary; preserve values. |
| Permission denied | Explain unavailable action and who can help; do not reveal protected record data. |
| Server error | Plain-language issue, retry if safe, support reference/correlation ID; avoid technical stack details. |
| Import partial/error | Show committed/rejected counts and exact next step; never imply rollback if partial rows have already posted. |
| Destructive/correction | Modal with record identifiers and consequences; require reason for reversal where policy requires; cancel is the safe default. |
| Stale data | Show “Updated through [time/date]” and source coverage; separate stale/import failure from current record data. |

## 13. Accessibility and usability requirements

- Target WCAG 2.2 AA for web contrast and interaction; verify all normal, hover, focus, disabled, success and error tokens against actual rendered text sizes.
- Full keyboard path for navigation, forms, tables, dialogs, filters, chart controls and dismiss actions. No keyboard traps; restore focus to the invoking control after a dialog/sheet closes.
- Semantic headings and landmarks; visible persistent labels; accessible names for icon-only controls; status and error announcements via live regions.
- Status, income/outflow and chart series use text, pattern or icon as well as color. Provide a data-table alternative for every chart.
- Support 200% zoom and mobile reflow without loss of key actions or horizontal page scrolling. Tables may scroll in their own region with a clear cue.
- Touch targets ≥48 px on mobile. Do not place destructive and primary actions adjacent without spacing/confirmation.
- Plain English and consistent names: “recorded cash,” “invoice,” “receipt,” “supplier bill,” “tracking label.” Define unfamiliar terms at first use.
- Provide reduced-motion behavior and do not use animation to signal financial success without text.
- Test with users of varied digital/accounting literacy, including one-handed Android use and low-bandwidth conditions.

## 14. Architecture and permission consistency checks

1. Every workspace-scoped list, detail and export uses the server-selected active organisation; a URL or client-supplied organisation ID never grants access.
2. Hidden navigation is not authorization. Server permission checks govern each view, mutation, download and export.
3. The UI distinguishes draft from posted records; posted correction is reversal/replacement, with reason and actor history, consistent with the architecture’s integrity guardrail.
4. Any KPI/report exposes period, provenance, freshness and a drill-down to records. Missing data is surfaced instead of silently represented as zero.
5. Import rows pass through the same normal transaction validation and audit path as manual entries; no CSV shortcut bypasses tenant constraints or posting rules.
6. Invoices and receipts express user-recorded states. No payment is executed or implied, and NRS validation is not claimed.
7. Tracking labels are not actual or connected bank accounts. No “live balance” status appears in MVP.
8. Team roles match the PRD matrix. Do not ship “scoped” staff permissions until resource-level enforcement exists. Deactivation and role change must revoke access promptly and be audited.
9. No AI assistant or prediction UI in MVP; deterministic Money Brief rules expose their basis and limitations.
10. Do not put confidential amounts in email subject lines, push/lock-screen text or analytics events by default.

## 15. Design validation before development

Prototype usability tasks should cover: account creation/workspace setup; first manual transaction; import a CSV with duplicates and invalid rows; create/share an invoice and record partial receipt; find overdue customer balance; record a supplier obligation; inspect a Money Brief observation and its sources; export a period report; invite/deactivate a bookkeeper; correct a posted mistake safely.

Measure task completion, time to first useful Money Brief, error recovery, role comprehension, confidence in displayed amounts and ability to trace a total to source records. Include modest Android/mobile viewport and low-bandwidth simulations. A pilot should validate the PRD’s first-value and recurring weekly review hypotheses; no visual approval substitutes for transaction integrity or tenant-isolation testing.

## 16. Development handoff checklist

- [ ] Link this specification and the editable Figma file in the implementation issue set.
- [ ] Reconfirm MVP boundaries and role matrix against the approved PRD before implementation.
- [ ] Approve the exact money storage/display precision and rounding behavior, invoice overpayment policy, correction/reversal lifecycle and report date semantics.
- [ ] Agree final breakpoints, mobile navigation and low-connectivity draft persistence with the architecture owner.
- [ ] Implement tokens as shared design variables/styles; document semantic color aliases and component states.
- [ ] Create keyboard/focus/error/empty/loading/success variants for every form, table, import step and dialog before build acceptance.
- [ ] Confirm each report/KPI formula and source drill-down against the API/domain contract; UI values are not authoritative calculations.
- [ ] Map each role to view/create/edit/post/reverse/export/settings actions and validate denied states on the server.
- [ ] Define supported CSV schemas, duplicate policy, partial-commit semantics, retry behavior and row-level error export.
- [ ] Validate invoice copy and PDF template against product/legal review; clearly distinguish ordinary invoice from fiscally validated NRS e-invoice.
- [ ] Validate Nigerian locale examples with product/accounting review; use synthetic sample business/contact data in prototypes and screenshots.
- [ ] Complete keyboard, screen reader, contrast, 200% zoom and responsive reviews against WCAG 2.2 AA targets.
- [ ] Confirm audit events, sensitive-data redaction, session/security flows, notification copy and re-authentication requirements.
- [ ] Run prototype tests with target owner/bookkeeper/accountant users and incorporate high-severity findings before code begins.
- [ ] Preserve no-custody/no-money-movement/no-lending boundary in labels, actions, support content and marketing claims.

## Appendix A — Screen/state inventory

| Screen family | MVP | Key states to design |
|---|---|---|
| Authentication/recovery | Yes | default, invalid code, expired code, rate-limited, recovery pending, session revoked |
| Workspace setup | Yes | step saved, skipped optional step, invalid field, resume, complete |
| Overview/Money Brief | Yes | first-use, partial data, stale import, normal, no attention items, load/error |
| Transactions | Yes | filtered empty, no records, draft, posted, permission denied, correction confirmation |
| CSV import | Yes | upload, map, preview, row errors, duplicates, commit pending, complete, partial/error, retry |
| Invoices/receipts | Yes | draft, shared, partial, paid, overdue, disputed, cancelled, validation, export/share error |
| Customers/suppliers | Yes | empty, duplicate suggestion, active, archived, activity, permission-limited |
| Bills/cash flow | Yes | none due, upcoming, overdue, stale/partial records, tracking label explanation |
| Reports/export | Yes | no data, results, filters, export queued, ready, failed, denied |
| Team/roles/audit | Yes | invite pending/expired/accepted/revoked, role confirmation, no access, audit empty |
| AI assistant/forecast/scenarios | No | Later phase only; no MVP route or active controls |
| Bank/payment integrations | No | Later phase only; no connect/pay controls |

## Appendix B — Sample data conventions

Use fictional Nigeria-specific examples only: **Kora Atelier**, Lagos; **Amina Okafor**, owner; **Adeola Foods**, customer; **Midas Packaging**, supplier; categories Sales, Transport, Rent and Repairs; tracking labels GTBank ••2041, POS settlement and Cash. Example figures in the editable screens (e.g. ₦2,845,300 recorded cash; ₦145,000 overdue invoice) are synthetic design content, not customer data or product performance claims. Use account masking only as a display example; never populate prototypes with credentials or real bank account details.
