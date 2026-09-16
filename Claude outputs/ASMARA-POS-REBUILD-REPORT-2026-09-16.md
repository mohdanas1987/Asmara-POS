# Asmara POS / RestaurantOS Rebuild — Status Report

**Prepared:** 2026-09-16
**Audience:** CTO review of work completed against the rebuild plan
**Scope:** (1) the original repository code review, (2) the reconciled build plan that came out of it, (3) everything built and fixed against that plan since, with test evidence.

---

## Part 1 — Repository Status Audit (2026-09-15)

Before adopting an external "CTO rebuild plan" (an 18-phase roadmap document) as the working roadmap, the repository was independently audited by direct code inspection — reading source, migrations, tests, routes, and models in the live project — rather than trusting the plan's own risk assessment or the project's governance docs at face value.

### Headline finding: the plan was working from an outdated snapshot

The plan's risk table marked "Existing security: Needs remediation" and treated Phase 0 as not started / Phase 1 as partial. That matched `DEVELOPMENT-PLAN.md` (dated 2026-09-04). But `phases/PHASE1-FINAL-REPORT.md` (dated 2026-09-05 — one day later) documented that Phase 1's security remediation had actually been completed and tested, and the live code confirmed it. The governance docs were never updated after that report, and substantial feature work had happened since. **The plan's risk list was describing the state of the repo from roughly September 3–4, not the day it was reviewed.**

### Point-by-point verification of the plan's claimed "serious existing technical risks"

| Risk claimed by the plan | Actual state found in the code |
|---|---|
| JWT secret hardcoded (`'whateverItWas'`) | **Fixed.** `config/auth.js` requires `JWT_SECRET` from the environment and refuses to start without one; `routes/auth.js` and `middlewares/loggedIn.js` both import from this one module. |
| Production MySQL credentials hardcoded in `db.js` | **Fixed.** `db.js` imports from `config/database.js`, which requires all four DB variables from the environment with no fallback. No literal credentials remain. |
| Unauthenticated state-changing tables API | **Fixed.** Every route in `routes/tables.js` (`/`, `/reservations`, `/update-position/:table`, `/split-table/:table_number`, `/free-all`, `/transfer`) requires authentication. |
| Redis / GraphQL dead dependencies | **Confirmed absent** — not installed at all. |
| `Reservation` model duplicating the `Report` model / pointing at the wrong table | **Fixed.** `Reservation` now points at a real `reservations` table with a correct relation to `tables`. |
| Customer-display window running with `nodeIntegration: true` | **Fixed.** Both Electron windows run with `nodeIntegration: false` and `contextIsolation: true`. |
| Two separate DB credential paths (`db.js` vs `knexfile.js`) | **Fixed.** Both import the same `config/database.js`. |
| `asmara-eindhoven.nl` / `pos.dftech.in` vendor integration ambiguity | **Documented, not resolved.** Still referenced in the code; whether this is a shared or dedicated vendor backend needs a vendor conversation, not more code reading. |

**Net effect:** 6 of the 7 concrete code-level risks the plan opened with were already closed and regression-tested. Only the external vendor relationship remained genuinely open, and it's a business question, not a code one.

### What already existed beyond what the plan assumed

- **Multi-tenancy** — fully implemented: `tenant_id` on every scoped table, JWT-based tenant resolution across every route file, adversarial cross-tenant isolation tests passing.
- **Billing / superadmin / tenant onboarding** — real routes, models, tests, and a frontend `/admin` section already existed, ahead of where the plan assumed the project was.
- **Payments infrastructure** — `routes/payments.js`, provider/terminal models, tests, and a settings UI existed, though the completeness of the payment-intent/refund/reconciliation model versus a simpler flow needed a closer read (this became task #37, covered in Part 3).
- **Table transfer** — implemented and tested.
- **Table-based ordering UX** — tap table → open/resume order → real menu photos → send to kitchen → charge & free table, built and working.
- **Real production data** — 95 items, 11 categories, 22 tables, real photos and logo, migrated into the new schema.

### What was genuinely missing (the plan was right about these)

- **RBAC** — only a free-text `type` column on `users`, no real permission model.
- **Loyalty** — zero code anywhere in the repo.
- **Offline-first foundation** — no outbox, no sync engine, no local queue.
- **QR/barcode customer identity, printable loyalty card** — not started.
- **A design system pass** — no shared tokens/components; each screen built individually.
- **Kitchen ticket routing as its own domain** (Product → Preparation Rule → Kitchen Station) — kitchen logic lived inside `orders.js`/`pos.js`, no dedicated domain.
- **Confirmed, current test results** — the sandboxed audit environment couldn't run the real test suite (a native-module architecture mismatch), so pass/fail counts needed to be reconfirmed by the owner directly.

### Reconciled priorities that came out of the audit

1. Production backup/restore (Phase 0) — blocked on the owner's explicit go-ahead to touch the live database. **Still blocked, by design — not attempted.**
2. RBAC as a real permission model.
3. Loyalty subsystem, ledger-based, from scratch.
4. Offline-first foundation, sequenced *before* finalizing table/floor and kitchen UX, since offline behavior touches those domains directly.
5. A real design system pass before more individual screens get built.
6. Kitchen ticket routing as its own domain concept.
7. An explicit decision on the billing/superadmin/SaaS code that already existed: keep building it now, or freeze it until the core POS is solid.

---

## Part 2 — The Build Plan

Following the audit, the above reconciled priorities were turned into a tracked task list and built in roughly this order. Where a decision point came up mid-build, the restaurant owner was asked directly rather than assumed:

- **Offline-first scope** — asked whether "offline-first" needed to protect against (a) multiple terminals in one restaurant, (b) future cloud/SaaS connectivity, or (c) external integrations only. Owner selected **all three**, which shaped the sync design (a generic, transport-agnostic outbox rather than one hardcoded to a single target).
- **SaaS/billing scope** (#39) — flagged as needing an explicit decision (keep building vs. freeze); **still open**, not yet decided.

The build plan, as tracked:

| # | Item | Status |
|---|---|---|
| 29 | Phase 0: Production backup & restore test | **Blocked** — requires the owner's explicit go-ahead to touch the live database. Not attempted. |
| 30 | RBAC: real permission model | **Done** |
| 31 | Loyalty subsystem (ledger-based) | **Done** |
| 32 | Offline-first foundation (outbox + sync engine) | **Done** |
| 33 | POS design system pass | **Done** |
| 34 | Kitchen ticket routing as its own domain | **Done** |
| 35 | Table/Floor management redesign | **Done** |
| 36 | Menu UX refinement | **Done** |
| 37 | Billing & payments completeness check | **Done** |
| 38 | Reporting (X/Z, VAT, sales, table performance) | **Done** — X/Z's VAT breakdown and tenant-isolation fixed earlier; sales (date-range) and table-performance reports built from scratch this session |
| 39 | SaaS scope decision (billing/superadmin/onboarding) | **Open decision, not made** |
| 40 | Menu modifiers & spice levels (new schema) | **Not started** — no backend schema exists |
| 41 | Live-reported bugs: VAT overcharge at POS + wrong dish photos | **Done** (found and fixed after the owner reported them directly) |
| 42 | Refund/void UI in the frontend | **Not started** — backend and API layer exist, no screen yet |

Longer-running items from earlier in the project, still open or in progress: tenant onboarding/subscription billing UI polish (#18–19), a super-admin panel (#20), native iOS/Android packaging (#24), the Electron desktop shell and hardware abstraction layer (#25/#27, in progress), and a cloud sync layer for multi-branch (#28).

---

## Part 3 — What Was Actually Built (with evidence)

Everything below is implemented, tested, and pushed to the branch `feature/rbac-kitchen-loyalty-payments-2026-09` for review. **151 backend tests pass** (`npm test` in `Docker-Backend-Test/backend`), and the frontend builds clean (`npx tsc --noEmit` and `npm run build` in `RestaurantOS-Frontend`).

### RBAC — real permission model (#30)

Added a `users.role` column, `config/permissions.js` (an explicit role → permission map: admin/manager/cashier/waiter/kitchen), a `requirePermission` middleware, and staff CRUD (`routes/users.js`).

**Bug found and fixed while building it:** `middlewares/loggedIn.js` was overwriting `req.body.role` — a field the staff-creation endpoint legitimately uses to mean "the role to assign this new person" — with the *caller's own* role. This broke staff creation (every new staff member silently got the creator's role) and would have let a privilege-escalation attempt silently succeed by comparing against the wrong value instead of being rejected. Fixed by renaming the trusted, server-set value to `req.authRole`, leaving the client-supplied `req.body.role` alone.

### Loyalty subsystem (#31)

Append-only ledger design: `loyalty_ledger` with a `balance_after` snapshot on every row; balance is always `SUM(points)`, never a mutable counter. Per-tenant configurable rates (`loyalty_config`), customer scannable codes, redeem/adjust endpoints, and an automatic best-effort earn hook on order finish.

**Bug found and fixed:** the ledger's "most recent transaction" query ordered by `created_at`, but SQLite's default timestamp only has second-level precision — two ledger rows written in the same second sorted ambiguously, returning the wrong balance. Fixed to order by the strictly-increasing `id` instead.

### Offline-first foundation (#32)

Built for the scope the owner confirmed (multiple terminals in one restaurant, future cloud connectivity, and external integrations): `sync_log` (append-only, per-entity monotonic version — a resumable change feed), `terminals` (stable per-device identity persisted to disk), and `outbox` (a generic, transport-agnostic retry queue with exponential backoff, used the same way whether the destination is a peer terminal, a future cloud API, or a payment/website integration).

### POS design system (#33)

Shared design tokens (surface/border/ink colors, dark mode via CSS variables), 44px minimum touch targets, and a shared component set (Toast, Dialog, Spinner, EmptyState, SearchInput with an on-screen keyboard for touch terminals, VirtualKeyboard, NumericKeypad) so screens stop looking like five different apps stitched together.

### Kitchen ticket routing as its own domain (#34)

New domain: `kitchen_stations` and `kitchen_tickets`, with routing logic (Product → its assigned station → a per-station ticket) pulled out of `orders.js`/`pos.js` into `services/kitchenRouting.js`.

**Bugs found and fixed:** the migration's backfill logic read from the `users` table to decide which tenants needed a default kitchen station — empty on a fresh database, since migrations run before any user is seeded, so zero stations were ever created. Fixed to read from `tenants` instead, plus added a defensive fallback that auto-creates a station on the fly if a tenant somehow still has none. Also found that brand-new tenants (via signup) never got a default station created at all — fixed in the same transaction as tenant creation.

### Table/Floor management redesign (#35)

Added `capacity` and `section` to tables, a merge action, a scoped "free selected tables" action (distinct from "free all"), and a bill-preview dialog before printing.

### Menu UX refinement + a real, previously-undiscovered VAT bug (#36)

Rebuilt the menu screen as searchable product cards (image, category, live tax breakdown) on the shared design tokens. While building the "VAT-inclusive pricing" requirement, found that **the entire codebase computed tax as `price × rate / 100`** (the exclusive-tax formula) in six separate places — but this is a Dutch restaurant, where menu prices are legally VAT-inclusive and nothing is added at checkout. The correct formula is `price × rate / (100 + rate)`. Fixed via one shared `utils/tax.js`, applied everywhere: item creation, order lines, the POS feed, and the X/Z report generator.

Also found, while wiring this up end-to-end, that **`POST /items/create`** — the actual route the live frontend calls when a new item is created — **never included a tax rate in its insert payload at all**, and no screen anywhere in the app ever let a tax rate be *set* on an item in the first place. Both gaps are now fixed: the route persists it, and the item form has a real VAT-rate dropdown fed from the tenant's configured tax rates.

### Two live bugs, reported directly by the restaurant owner while testing

- **The POS was overcharging every sale.** `useCart.ts` hardcoded a flat 9% and *added it on top* of prices that are already VAT-inclusive — meaning every real checkout was inflating the actual charged total by roughly 9%, on top of a price that already contained the correct VAT. Fixed to break the existing (correct) total down into net/VAT components using each item's real tax rate, instead of adding a second tax on top of one already priced in.
- **Dish photos were wrong on the POS screen.** `GET /pos/items` preferred a legacy `thumb` column — stale data left over from the original recovered production database — over the real `image` uploaded through the item form. No matter what photo was uploaded, the POS kept showing the old, unrelated stock image. Fixed to prefer the real uploaded photo, only falling back to the legacy one for an item that never had a real photo set.

### Billing & payments completeness (#37)

The actual checkout endpoints (`/orders/create`, `/orders/payment-update`) never persisted a real transaction at all — just a `payment_mode` string and a raw JSON blob on the order, with `payment_status` hardcoded to `"paid"` unconditionally, even on an underpayment. Built a real append-only `payment_transactions` ledger and wired it in:

- Every charge, split payment, refund, and void is now a real recorded row.
- `payment_status` is derived from what was actually paid. The common case — one charge covering the full total — still resolves to `"paid"`, exactly as before. A genuine partial payment now correctly shows `"partial"` instead of being silently marked fully paid.
- Added `POST /orders/:order/refund` and `POST /orders/payments/:id/void`, both gated to manager/admin only, and `GET /orders/:order/payments` for the full transaction history of an order.
- This also directly improves reporting accuracy (#38), since the revenue reports already only count `payment_status: 'paid'` orders — a partial payment will no longer be miscounted as full revenue.

The frontend API functions for this exist (`getOrderPayments`, `refundOrder`, `voidPaymentTransaction`), but there is no button/screen yet to trigger a refund from the UI — tracked as its own follow-up (#42) rather than rushed.

**A real bug caught before it shipped:** the first version of the payment ledger service had a wrong relative import path, which would have crashed the entire backend on startup. Caught by the owner's test run, root-caused (an off-by-one directory level in a `require()` path), fixed, and reconfirmed with a full clean test run before declaring it done.

### Reporting: sales & table performance, built from scratch (#38)

The X/Z report (utils.js's `generateReport`) already covered VAT breakdown and per-session
totals, and its tenant-isolation bug was fixed earlier (see the reports-tenant-isolation
suite). What the plan's "sales" and "table performance" requirements called for did not
exist anywhere in the app: there was no date-range business dashboard independent of a
register session, and no per-table revenue/turnover breakdown at all.

Added `GET /reports/sales?from=&to=` (revenue, paid-order count, average order value,
revenue by day, by category, by payment method, and top items, defaulting to the trailing
30 days) and `GET /reports/table-performance?from=&to=` (per-table order count, revenue,
average order value, and average turnover time computed from each order's created_at →
updated_at, including tables with zero activity so an idle table is a visible signal, not a
silent omission). Both are read-only — unlike a Z-report they never delete or free
anything — tenant-scoped, and gated behind the existing `reports.view` permission (a
kitchen-role account gets a 403). The frontend Reports page gained a "Sales & Tables" tab
with a date-range picker alongside the existing X/Z tab, which is otherwise untouched.

Revenue counts only `payment_status: 'paid'` orders, consistent with the X/Z report and the
payments-ledger's derived status — a partial payment is surfaced as its own "partial
payments" count rather than folded into revenue and overstating it. A merged-table order
(e.g. "1+2") is reported as its own row rather than splitting its revenue across member
tables by some invented rule, since the schema doesn't record how a merged bill should be
allocated between them.

Covered by a new test suite (`test/sales-and-table-reports.test.js`): revenue/date-range
filtering correctness (a partial order and an out-of-range order must not count), category
and top-item breakdown, per-table grouping and turnover-time calculation, idle tables still
listed at zero, RBAC gating, and cross-tenant isolation.

### Test evidence

- Backend: **151/151 tests passing** (`node --test`), including RBAC permission gating, tenant isolation, and the full payments ledger suite (full payment, partial payment, over-refund rejection, double-void rejection, and cross-tenant isolation on refunds).
- Frontend: clean `tsc --noEmit` and a successful `next build` across all 18 routes.

### What's explicitly still open (not silently skipped)

- **Menu modifiers and spice levels** (#40) — no backend schema exists yet; needs its own migration, models, and UI, and will affect kitchen tickets and pricing.
- **Refund/void UI** (#42) — the backend and API layer are ready; needs a screen.
- **The SaaS scope decision** (#39) — whether to keep extending the existing billing/superadmin/onboarding code now, or freeze it until the core POS is fully solid. This needs an explicit answer, not an assumption.
- **Production backup/restore** (#29) — still blocked on explicit authorization to touch the live database.
- Native iOS/Android packaging, the Electron hardware abstraction layer, and multi-branch cloud sync remain in progress or not yet started.

---

*This report and the branch it describes (`feature/rbac-kitchen-loyalty-payments-2026-09`) are ready for CTO review. The commit message on that branch mirrors the technical detail in Part 3.*
