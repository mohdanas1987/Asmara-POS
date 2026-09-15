# ASMARA POS → RestaurantOS
## Master Phase Roadmap v1.0 — Phase 1 through Phase 100

**Companion to:** FDD v1.0, TDD v1.0, Engineering Bible v1.1, `DEVELOPMENT-PLAN.md`
**Purpose:** The Engineering Bible defines 19 macro-phases (Phase 0–19). This document breaks those macro-phases into ~100 concrete, shippable phases — each one small enough to implement, test, and sign off on its own, per Bible §25–26 (self-review + phase report) before the next phase starts.
**Rule inherited from the Bible:** every phase here still requires reading Bible → FDD → TDD → previous phase report first, still ends with a phase report and a PASS/CONDITIONAL PASS/FAIL verdict, and still waits for CTO + business-owner sign-off before the next phase begins. Numbering is sequential for tracking; it is not a promise that phases take equal time — Phase 28 (Table Transfer) is a multi-week effort, Phase 5 might be a single afternoon.
**Also inherited:** nothing here overrides the open blocking item already on record — Phase 0's live database backup still needs to happen outside this sandboxed session (your own terminal, or Hostinger's hPanel) before Phase 1 can be called complete.

This roadmap is organized into 20 **Stages**, matching the Bible's 19 macro-phases plus one at the very end for commercial launch. Each stage ends with a gate phase — no stage's later phases start before its gate passes.

---

## STAGE 0 — Production Safety & Baseline *(Bible Phase 0)*

1. **Full backup capture** — database (once reachable), application build, source, migrations, media, local SQLite, config files. Already substantially covered by the existing zip snapshot; the live DB piece is still open.
2. **Verified restore drill** — restore every backup from Phase 1 into an isolated copy and prove it's intact (row counts, spot checks, file integrity) — never restore into production.
3. **Functionality baseline certification** — manually walk the FDD §37 regression list (login → register → table → order → kitchen → transfer → payment → receipt → reports → close) against the live system and document exactly what works today, as evidence, not assumption.
4. **Hardware & printer topology documentation** — model numbers, connection types, and driver quirks for every printer, the cash drawer, and the customer display at the physical restaurant, captured from the people who run the floor.
5. **Stage 0 gate** — Phase 0 report per Bible §26, PASS/CONDITIONAL PASS/FAIL, held for business-owner + CTO review. Nothing in Stage 1 starts before this passes.

## STAGE 1 — Complete Architecture Discovery *(Bible Phase 1)*

6. **Production schema capture** — pull the actual live MySQL schema (from the Phase 0 backup) and diff it against the migration history already flagged as inconsistent.
7. **Credential reconciliation** — confirm whether `db.js`'s hardcoded credentials and `knexfile.js`'s `.env`-driven credentials point at the same database, or have quietly diverged.
8. **Vendor integration deep-dive** — determine what `pos.dftech.in` actually is (dedicated to Asmara, or the vendor's shared multi-tenant backend), what data it already holds, and what the `GET /config/upload-db/:client` backup channel has been sending it.
9. **Website integration confirmation** — trace the `asmara-eindhoven.nl` image-upload call and the website's reservation form end-to-end with the site's own operator, since the POS backend has no reservation table to receive anything into.
10. **GH_TOKEN scope check** — verify the embedded GitHub token's actual permissions via GitHub's API (safe, read-only, no production contact needed).
11. **Security threat model** — formal threat → impact → business-risk → fix → regression-test table for every finding in the v1.1 addendum (JWT secret, hardcoded DB creds, open CORS, unauthenticated routes, etc.).
12. **Stage 1 gate** — publish `Architecture Bible v2.0 — VERIFIED BASELINE` per Bible §34, formal sign-off. This is the last phase before any code changes are allowed.

## STAGE 2 — Core Codebase Remediation *(Bible Phase 2)* — behavior-preserving cleanup only

13. **JWT secret fix** — move off the hardcoded `'whateverItWas'` literal to a per-install, environment-injected secret; no workflow change, immediate risk reduction.
14. **Database credential fix** — move `db.js`'s hardcoded MySQL credentials into environment configuration, single source of truth shared with `knexfile.js`.
15. **CORS lockdown** — replace the open `cors()` with an explicit allowlist of the origins the POS legitimately serves.
16. **Auth-middleware gap closure** — add `fetchuser` (or its replacement) to every state-changing route currently missing it, starting with all of `tables.js`.
17. **HTTP-verb correction** — convert the GET-based mutations (cancel order, finish order, remove menu category, remove report, toggle endpoints, free-all-tables, etc.) to POST/PATCH/DELETE as appropriate.
18. **Dead-code quarantine** — formally isolate (not yet delete) Redis, GraphQL, and Nisarga-legacy code now that they're confirmed non-functional in the shipped build, pending Stage 2's dependency-verification step before actual removal.
19. **Structured logging & error handling baseline** — replace ad hoc `console.log`s with structured, leveled logging; standardize API error shapes.
20. **Module boundary cleanup** — reorganize routes/models/utils along the domain-module lines the TDD defines (§4), without changing any business behavior.
21. **Stage 2 regression pass** — full FDD §37 regression list re-run against the cleaned-up code, confirming zero behavior change.
22. **Stage 2 gate** — phase report + sign-off.

## STAGE 3 — Database & Domain Correction *(Bible Phase 3)*

23. **Products/menu naming reconciliation** — resolve the `products`/`product_categories` vs. `menu_items`/`menu_categories` duplication, one authoritative model.
24. **Real Reservation domain model** — replace the broken `Reservation.js` (currently an alias of `Report`) with an actual `reservations` table and model: date, time, guest count, customer, table, status, notes, source.
25. **Order data normalization (first pass)** — begin moving the most reporting-critical fields out of raw JSON blobs into proper columns/child tables, without a full rewrite.
26. **Constraints & indexes** — add missing foreign keys, unique constraints, and indexes identified during schema reconciliation.
27. **Authoritative migration set** — retire the inconsistent migration history in favor of one verified, linear migration path forward.
28. **Migration rehearsal** — run the new migrations against a full copy of production data; verify row counts, relationships, and application behavior before touching production.
29. **Stage 3 gate** — phase report + sign-off. This is the last phase before production schema changes are actually applied.

## STAGE 4 — Transaction & Order Engine Hardening *(Bible Phase 4)*

30. **Explicit order state machine** — implement the OPEN → IN_PROGRESS → SENT_TO_KITCHEN → READY → PAYMENT_PENDING → PAID → COMPLETED lifecycle as real, enforced state, not implicit status strings.
31. **Table Transfer — data model & domain operation** — the new mandatory feature (FDD §7–8, TDD §13–14): design and implement `transferTable(orderId, sourceTableId, destinationTableId, userId, terminalId)` as one atomic, all-or-nothing transaction.
32. **Table Transfer — occupied-destination handling** — build the explicit cancel/merge decision flow required when the destination table isn't empty.
33. **Table Transfer — audit & notification** — record every transfer (order, source, destination, user, terminal, timestamp, reason) and generate the optional kitchen notification.
34. **Table Transfer — concurrency safety** — row locking or optimistic versioning so two terminals can't transfer the same order at once.
35. **Order idempotency** — idempotency keys for order creation, kitchen submission, and payment, so retries never duplicate a business effect.
36. **Kitchen routing refactor** — replace category-name string matching with a proper Product → Preparation Rule → Kitchen Station model, configurable per restaurant.
37. **Cash register / X-Z report hardening** — make register open/close and report generation transactional, idempotent, and immutable once closed.
38. **Stage 4 end-to-end test** — the full critical E2E path from TDD §35 (login → open register → table → order → items → kitchen → **transfer table** → modify → payment → receipt → complete → X → Z → close) run and passing.
39. **Stage 4 gate** — phase report + sign-off.

## STAGE 5 — Authentication & Authorization Security *(Bible Phase 5)*

40. **RBAC data model** — real `roles` and `permissions` tables backing the Owner/Manager/Cashier/Waiter/Kitchen roles from FDD §5, configurable rather than hardcoded.
41. **Per-route authorization audit** — every endpoint mapped to the roles/permissions allowed to call it, enforced server-side (frontend hiding doesn't count, per Bible §12).
42. **Session/token hardening** — short-lived tokens, refresh flow, secure secret management building on Phase 13's JWT fix.
43. **Audit logging** — login, price changes, cancellations, table transfers, payments, refunds, register open/close, and permission changes all recorded per Bible §35.
44. **Auth abuse protection** — rate limiting and lockout behavior on login and other sensitive endpoints.
45. **Stage 5 gate** — security review + sign-off.

## STAGE 6 — POS Hardware Architecture *(Bible Phase 6)*

46. **Printer abstraction layer** — a single hardware-service interface behind which receipt and kitchen printers sit, so business logic never talks to a specific printer driver directly.
47. **Cash drawer & customer-display abstraction** — same pattern applied to the drawer and the customer-facing screen, including fixing the `nodeIntegration: true` inconsistency found on that window.
48. **Hardware failure handling** — printer offline, drawer failure, and display failure become first-class, alertable operational states instead of silent failures.
49. **Stage 6 gate** — phase report + sign-off.

## STAGE 7 — Offline-First Foundation *(Bible Phase 7)*

50. **Durable local outbox** — every local transaction gets a UUID, tenant/location/terminal stamp, sequence number, and idempotency key before it's considered "written."
51. **Terminal identity** — each POS terminal gets a stable, registered identity independent of the database it happens to be talking to.
52. **Sync engine (first version)** — local outbox → cloud API → acknowledgement → marked-synced, replacing the current "just switch the DB connection" approach.
53. **Conflict handling** — a defined (even if initially conservative) strategy for what happens when two terminals' offline changes collide on reconnect.
54. **Offline failure-mode testing** — simulate network loss mid-service and confirm the POS keeps taking orders and reconciles cleanly afterward.
55. **Stage 7 gate** — phase report + sign-off.

## STAGE 8 — Configuration & Tenant-Ready Foundation *(Bible Phase 8)*

56. **Configuration hierarchy schema** — Platform → Tenant → Brand → Location → Terminal configuration tables, more-specific overriding broader defaults.
57. **De-hardcode restaurant-specific behavior** — every remaining `if restaurant == "Asmara"`-shaped decision becomes a configuration value instead.
58. **Terminal registration & management** — terminals become manageable entities (assigned location, register, printers, capabilities) rather than implicit.
59. **Settings/configuration UI** — an actual interface for managing the hierarchy above, instead of hand-editing settings rows.
60. **Stage 8 gate** — phase report + sign-off.

## STAGE 9 — Reporting / Audit / Financial Integrity *(Bible Phase 9)*

61. **Reports from source-of-truth** — X/Z, sales, payment, tax, and cashier reports derived live from transactional data, with the current PDF-file approach becoming an export format, not the system of record.
62. **Financial reconciliation tooling** — a way to verify that register totals, payments, and reports agree with each other, with discrepancies surfaced rather than hidden.
63. **Audit trail UI/export** — the audit log from Phase 43 becomes something a manager can actually search and export.
64. **Stage 9 gate** — phase report + sign-off.

## STAGE 10 — Integration Architecture *(Bible Phase 10)*

65. **Website adapter** — the `asmara-eindhoven.nl` relationship becomes a formal, isolated, optional, retryable adapter instead of a hardcoded frontend call.
66. **Price synchronization (POS → Website)** — the FDD's top integration priority: enable/disable, per-product/category selection, manual + automatic sync, retry, status, and audit.
67. **Payment provider adapter framework** — cash, card, and external-terminal payments behind a common interface, so no single provider is wired into the core order engine.
68. **Vendor integration decision** — formally decide what happens to the `pos.dftech.in` relationship: keep it behind an explicit adapter, renegotiate it, or replace it, based on Stage 1's findings.
69. **Stage 10 gate** — phase report + sign-off.

## STAGE 11 — Observability / Reliability / Recovery *(Bible Phase 11)*

70. **Centralized structured logging** — logs carrying tenant/location/terminal/user/request-ID/transaction-ID, shipped somewhere searchable, never containing secrets.
71. **Health checks & metrics** — the backend and sync engine expose health/status that can be monitored, not just inferred from user complaints.
72. **Durable job/queue system** — the local cron scheduler is replaced with a proper queue → worker → job → result pipeline supporting retry and monitoring.
73. **Stage 11 gate** — phase report + sign-off.

## STAGE 12 — Asmara Production Certification *(Bible Phase 12)*

74. **Full FDD/TDD regression** — every requirement in both documents checked PASS/FAIL against the now-hardened system.
75. **Load/performance sanity test** — simulate a fully-occupied Friday-night dinner service load against the hardened backend.
76. **Production Certification** — formal milestone: *Asmara POS, hardened*. This is the point where the original restaurant's system is genuinely production-grade, independent of any SaaS ambition. Everything from here on is explicitly optional expansion, not required to keep Asmara running well.

## STAGE 13 — SaaS Foundation *(Bible Phase 13)*

77. **Multi-tenant data model** — `tenant_id` (and `location_id`, `terminal_id` where relevant) introduced across core tables, enforced at the query layer, never trusted from the client.
78. **Platform identity service** — authentication becomes tenant-aware, supporting more than one restaurant's users under one platform.
79. **Tenant provisioning & onboarding** — the mechanics of standing up a new tenant (schema/data scoping, initial configuration, first admin user).
80. **Asmara migrated into the tenant model** — Asmara becomes Tenant #1 with a zero-downtime migration plan, per the Bible's founding principle that Asmara is never thrown away.
81. **Billing/plan scaffolding** — the data model for plans and entitlements, not yet a working billing system.
82. **Stage 13 gate** — phase report + sign-off.

## STAGE 14 — Multi-POS / Multi-Terminal *(Bible Phase 14)*

83. **Concurrent-terminal integrity** — multiple terminals at one location sharing tables/orders/registers without corrupting each other's state.
84. **Real-time terminal sync** — table and order updates propagate between terminals live (an explicit, designed real-time layer — not the unused Pusher reference found in the original bundle).
85. **Stage 14 gate** — phase report + sign-off.

## STAGE 15 — Multi-Location *(Bible Phase 15)*

86. **Location entity & scoping** — menus, prices, taxes, tables, terminals, and staff all become location-scoped under one tenant.
87. **Cross-location reporting** — roll-up reports across a tenant's multiple locations.
88. **Location configuration UI** — managing per-location differences without touching code.
89. **Stage 15 gate** — phase report + sign-off.

## STAGE 16 — Enterprise Restaurant Groups *(Bible Phase 16)*

90. **Brand hierarchy** — multiple brands under one tenant (a restaurant group running several concepts).
91. **Enterprise role/permission scoping** — permissions that span or are scoped across brands and locations for group-level staff.
92. **Stage 16 gate** — phase report + sign-off.

## STAGE 17 — Globalization *(Bible Phase 17)*

93. **Multi-currency & multi-language** — currency precision/rounding rules and full UI localization.
94. **Country-specific tax/fiscalization framework** — pluggable tax rules and fiscal compliance instead of one hardcoded VAT model.
95. **Timezone-aware operations** — every location operates and reports in its own timezone correctly.
96. **Stage 17 gate** — phase report + sign-off.

## STAGE 18 — SaaS Operations / Billing / Plans *(Bible Phase 18)*

97. **Subscription billing** — the Phase 81 scaffolding becomes a working billing system with real plans and metering.
98. **Platform admin console** — tenant management, feature flags, support tooling, system health, for whoever operates the platform.
99. **Self-serve tenant signup** — a new restaurant can onboard itself without a manual engineering setup.

## STAGE 19 — Advanced Platform *(Bible Phase 19, plus commercial launch)*

100. **Advanced modules & launch readiness** — inventory/recipes/suppliers/purchasing, loyalty and customer marketing, delivery/online-ordering channel integrations, accounting integration adapters, and the AI restaurant-assistant layer (sales/margin/staffing insights) from the original product vision — bundled and reviewed together as the **RestaurantOS v1.0 commercial launch readiness gate**.

---

## THE END PRODUCT, AFTER ALL 100 PHASES

What exists at the end is not a rewritten Asmara POS — it's a platform Asmara's system became the first proven tenant of. Concretely:

**RestaurantOS** — a multi-tenant, multi-location, multi-terminal restaurant management platform, offline-first at the terminal level and cloud-coordinated above it. A restaurant group anywhere in the world can sign up, configure their menu/tax/currency/language/kitchen-routing/payment setup entirely through configuration (never a code fork), and run anywhere from one POS terminal to hundreds across many locations without hitting an architectural wall — because every stage above was built against that requirement from Stage 13 onward, not bolted on afterward.

Operationally, each POS terminal still does everything the original Asmara POS did — take orders, print to the kitchen, open the cash drawer, run the customer display, close out X/Z reports — except now every one of those actions is authenticated, authorized, audited, idempotent, and safe to retry; a network outage no longer means the restaurant stops selling; a busy table needing to move mid-service is a first-class, safe operation instead of a manual workaround; and financial data (payments, register totals, reports) is provably consistent rather than trusted by assumption.

Above the terminal, a cloud platform provides tenant and location management, role- and permission-based staff access, cross-location reporting, an integrations layer (website price sync, payment providers, delivery channels, accounting) built on adapters so no external vendor is a hidden dependency, subscription billing and plans, a platform admin console for support and operations, and — as the final layer, deliberately built last — an AI assistant that can answer questions like "which dishes are declining" or "predict tomorrow's demand" from the now-trustworthy transactional data underneath it.

Asmara Restaurant in Eindhoven is still running on it, unchanged from the customer's point of view except that it now works better under real Friday-night pressure — because per the Engineering Bible's founding rule, it was never the thing being rebuilt. It was always the proof that the platform underneath it actually works.
