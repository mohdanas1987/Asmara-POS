# Asmara POS — Repository Status Audit (vs. the 19-point rebuild plan)

**Date:** 2026-09-15
**Purpose:** Verify the external "CTO rebuild plan" review against what is actually in this codebase right now, before adopting it as the roadmap. Method: direct code inspection (grep/read of source, migrations, tests, routes, models) in the live project folder — not a re-read of the governance docs alone, since those docs are shown below to be stale in places.

## Headline finding: the plan is working from an outdated snapshot

The plan's overall verdict table marks "Existing security: 🔴 Needs remediation" and treats Phase 0 as not started / Phase 1 as partial. That matches `DEVELOPMENT-PLAN.md` (dated 2026-09-04), which does say Phase 0 is "NOT STARTED." But `phases/PHASE1-FINAL-REPORT.md` (dated 2026-09-05, i.e. one day later) documents that Phase 1's security remediation was actually completed and tested, and the live code confirms it. The governance docs were never updated after that report, and a lot of feature work has happened since (this project's own commit history / this session's work: multi-tenant data migration, real menu/table/image sync, table-ordering flow, git repo setup on 2026-09-15). **The plan's risk list is describing a state this repo was in on ~Sept 3-4, not today.**

## Point-by-point verification of the plan's "serious existing technical risks" (§3)

| Risk claimed by the plan | Actual current state (verified by reading the file) |
|---|---|
| JWT secret hardcoded (`'whateverItWas'`) | **FIXED.** `backend/config/auth.js` now requires `JWT_SECRET` from the environment, refuses to start without one, and explicitly throws if it's still the old literal. Both `routes/auth.js` and `middlewares/loggedIn.js` import from this single module now. |
| Production MySQL credentials hardcoded in `db.js` | **FIXED.** `backend/db.js` now imports from `config/database.js`, which requires all four DB vars from the environment with no fallback. Confirmed no literal credential strings remain in `db.js`. |
| Unauthenticated state-changing tables API | **FIXED.** Every route in `routes/tables.js` (`/`, `/reservations`, `/update-position/:table`, `/split-table/:table_number`, `/free-all`, `/transfer`) has `fetchuser` applied. Code comment cites this as a specific closed vulnerability ("could set every table... to 'free' on a single unauthenticated GET request"). |
| Redis / GraphQL dead dependencies | **CONFIRMED ABSENT** — not in `package.json` at all (not just unused, genuinely not installed). |
| `Reservation` model duplicates `Report` model / points at `reports` table | **FIXED.** `models/Reservation.js` now points at a real `reservations` table (`migrations_local/0002_reservations_table.js`) with a correct relation to `tables`. Code comment documents the original bug and the fix. |
| Customer-display window `nodeIntegration: true` | **FIXED.** `RestaurantOS-Desktop/main.js` sets `nodeIntegration: false` and `contextIsolation: true` on both windows; comment explicitly ties this to "the Stage 2b fix already applied." |
| Two separate DB credential paths (`db.js` vs `knexfile.js`) | **FIXED.** Both now import the same `config/database.js` — one source of truth. |
| External systems `asmara-eindhoven.nl` / `pos.dftech.in` ambiguity | **Documented, not yet fully resolved.** Still referenced in `routes/config.js`, `routes/items.js`, and a dedicated `settings/website` frontend page + `website.test.js` exist, suggesting active work on this integration, but the vendor-side nature of `pos.dftech.in` (shared vs. dedicated backend) was never independently confirmed outside the code. |

**Net effect:** 6 of the 7 concrete code-level risks the plan opens with are already closed and regression-tested. Only the external-vendor-relationship question remains genuinely open, and it isn't a security fix, it's a business/vendor question no amount of code reading resolves.

## What actually exists beyond what the plan assumed

The plan assumes we're still largely at the planning stage for most of Phases 2–15. That's not accurate either — real, tested code already exists for several of the "not built yet" areas:

- **Multi-tenancy**: fully implemented, not just designed — `tenant_id` on every scoped table, per-tenant uniqueness constraints, JWT-based tenant resolution across all 8 original route files, adversarial cross-tenant isolation tests passing (per `PHASE1-FINAL-REPORT.md` and `multitenancy.test.js`).
- **Billing / superadmin / tenant onboarding**: `routes/billing.js`, `routes/billing-admin.js`, `routes/superadmin.js`, `models/Plan.js`, `models/Subscription.js`, plus `billing.test.js`, `superadmin.test.js`, `tenant-onboarding.test.js`, and a frontend `/admin` + `/admin/billing` section. This is real SaaS-platform groundwork the plan explicitly says "not yet" (§15) — it's already partially built. Worth a conscious decision on whether to keep building this now or actually shelve it per the plan's own advice.
- **Payments**: `routes/payments.js`, `models/PaymentProvider.js`, `models/PaymentTerminalSettings.js`, a `payment_terminals` migration, `payments.test.js`, plus a frontend `PaymentModal.tsx` and `usePaymentStatus` hook, and a `settings/payments` page. Real infrastructure exists, though it's not yet confirmed how complete the payment-intent/attempt/refund/reconciliation model the plan describes (§5) actually is versus a simpler pay-and-done flow — needs a closer read before claiming parity.
- **Table transfer**: implemented and tested (`table-transfer.test.js`), matching the plan's expectation that this was already planned.
- **Table-based ordering UX**: built this session — tap table → open/resume order → real menu photos → send to kitchen → charge & free table. Not the full floor-plan/section/merge/split experience the plan describes in Phase 6, but real functional groundwork, not zero.
- **Real menu/table/branding data**: migrated from the live production database (95 items, 11 categories, 22 tables, real photos, real logo) into the new schema, on both the Windows machine and this Mac dev environment.

## What is genuinely missing (the plan is right about these)

- **RBAC**: only a free-text `type` column on `users` (defaults to `'cashier'`), no permission model, no dedicated roles/permissions tables or middleware. The plan's point #12 (permission-based RBAC instead of `if role == "admin"`) is a real, unaddressed gap.
- **Loyalty**: zero code found anywhere in the repo (`find -iname "*loyalty*"` — no matches). This is a from-scratch subsystem, exactly as the plan says (§9-11).
- **Offline-first**: no outbox, no sync engine, no local-queue code found anywhere (the only sync-adjacent file found was an old broken PWA service worker in a stale packaged build, already known and being phased out). This is a real, unstarted foundation piece, correctly flagged by the plan as high-priority infrastructure, not a UI feature.
- **QR/barcode customer identity, printable loyalty card**: not started.
- **Design system phase** (touch keyboard, unified dark/light theme, consistent dialogs/inputs across screens): not started as a distinct layer; each page so far has been built individually.
- **Kitchen ticket routing (Product → Preparation Rule → Kitchen Station) / real KDS**: no dedicated `kitchen` route or model found on the backend; kitchen functionality currently appears to live inside `orders.js`/`pos.js` rather than as its own domain, so the printer/station routing abstraction the plan describes in §8 doesn't exist yet.
- **Automated test verification right now**: I could not run the actual test suite from this session — `npm test` fails inside the sandboxed shell because `bcrypt`'s native binding was compiled for macOS and this shell's Linux VM can't load it (`invalid ELF header`). This is an environment limitation, not a code problem, but it means the "26/29 tests passing" figures in `PHASE1-FINAL-REPORT.md` are historical, not reconfirmed today. **You should run `npm test` in `Docker-Backend-Test/backend` yourself in your real Terminal to get a current pass/fail count** before trusting any status claim (including this audit) on test coverage.

## Recommended reconciliation of the plan's phase sequence

Given the above, the plan's own Phase 0-3 (production safety, verified baseline, security stabilization, domain foundation) are **substantially further along than the plan assumes** — most of Phase 2's security items are done, and meaningful pieces of Phase 3 (multi-tenant domain model, payments, order/table domain objects) already exist. The plan's Phase 0 (production DB backup / restore test) is the one item that's genuinely still not done and still requires your explicit go-ahead to touch the live `srv1399.hstgr.io` database, exactly as `DEVELOPMENT-PLAN.md` already flagged.

The parts of the plan that are correctly identified as real, unstarted gaps and should drive the next phase of work are:
1. Production backup/restore (Phase 0) — still blocked on your explicit yes/no for live DB access.
2. RBAC as a real permission model (not a string column).
3. Loyalty subsystem, ledger-based, from scratch.
4. Offline-first foundation (outbox + sync engine) — this should probably come **before** the table/floor and kitchen UX phases are finalized, since offline behavior touches those domains directly rather than sitting on top of them.
5. A real design system pass before more individual screens are built, to avoid the "five screens that look different" problem the plan calls out.
6. Kitchen ticket routing as its own domain concept, not logic buried in `orders.js`.
7. A decision on the billing/superadmin/SaaS-platform code that already exists: keep extending it now, or intentionally freeze it per the plan's "not yet" recommendation (§15) until the core POS is solid. Recommend making this an explicit choice rather than letting it grow by default.

## What I did not verify

- The actual completeness of the payment-intent/attempt/reconciliation model vs. a simpler flow (needs a closer read of `routes/payments.js` and its tests).
- Whether `pos.dftech.in`'s role (shared vendor backend vs. dedicated) has been resolved since the Phase 1 report — still appears to require a vendor conversation, not more code reading.
- Current automated test pass/fail count (blocked by the sandboxed shell's native-module limitation — needs you to run it).
