# ASMARA POS — Master Development Specification v2.0

**Supersedes:** the v1.0 100-phase roadmap, as a standalone document. It does NOT replace `01-FDD-v1.0.md`, `02-TDD-v1.0.md`, or `03-ENGINEERING-BIBLE-v1.1.md` — those remain the formal supporting documents this specification is built from and must still be re-read before every phase per Bible §24.
**Status:** DRAFT v2.0 — incorporates the CTO review's 15 amendments in full. Ready for CTO re-review and freeze.
**Change basis:** every gap identified in the CTO review of v1.0 is addressed below, either as a standing governance rule (cross-cutting, applies to many phases) or as a specific phase insertion (a one-time deliverable). Each amendment below is labeled with the gap number it answers.

---

## 0. GOVERNING DIRECTIVE (read this before anything else)

> Build a production-grade Asmara POS first, while ensuring every foundational architectural decision is SaaS-compatible. Do not build the SaaS platform now.

This is the single sentence that resolves the ambiguity the CTO flagged. Every phase below that touches Stages 0–12 is Asmara-POS-hardening work. The requirement to make each of those decisions "SaaS-compatible" means: don't hardcode `tenant_id` assumptions away, don't design the Table Transfer domain model in a way that makes a future partial transfer impossible, don't build payment handling that only works for one provider — but it does NOT mean building multi-tenancy, billing, or a platform admin console now. Those stay in Stages 13–19, untouched until Stage 12 certifies Asmara itself.

If at any point a phase in Stages 0–12 starts producing SaaS-shaped deliverables (a tenant table, a billing model, a platform console) that is scope creep and must be logged as `DEFERRED / DISCOVERED ITEM` per Bible §23, not built early out of enthusiasm.

---

## 1. STANDING GOVERNANCE ADDITIONS

These are not one-time phases. They are permanent rules, added to the Engineering Bible's authority, that apply across many phases for the rest of the project. Treat this section as Bible v1.2 in substance, pending the CTO formally versioning it that way.

### 1.A — Production Functionality Preservation Contract *(answers Gap 1)*

A functionality baseline is not enough on its own. From Stage 0 onward, the project maintains one living document — `PRESERVATION-CONTRACT.md` — that inventories, by name, everything currently working, split into three registers:

**Hardware register:** every POS printer, every kitchen printer, the cash drawer, the customer display, printer routing rules, printer configuration, printer drivers, printing formats.

**Data register:** every product, every category, every product image, every tax, every customer, every historical order, every report, every reservation, every table, every configuration value.

**Operations register:** direct sales, table orders, order modification, kitchen submission, payment, receipt, reprint, X report, Z report, day close, table split, table linking, table transfer.

**The rule:** nothing on any register may disappear simply because the architecture was refactored. This is not an informal expectation — it is a hard gate. Every phase's report (Bible §26) must include a "Preservation Contract check" section confirming every register item it touched is still present and working, and the contract document itself gets updated whenever something is added, renamed, or (rarely, and only with explicit sign-off) deliberately retired. Stage 0's phase 4 produces the first version of this contract; Stage 12's certification phase re-verifies it against the fully hardened system before Asmara is declared production-certified.

### 1.B — Website Freeze Policy *(answers Gap 6)*

Stated at full strength, as the CTO asked:

> **NO DIRECT WEBSITE DEVELOPMENT IS AUTHORIZED.** The only permitted actions toward `asmara-eindhoven.nl` are: inspect, document, integrate, and synchronize price where explicitly approved.

The website is an **External System behind an Optional Integration**, never a dependency of the POS core. No phase in this specification redesigns it, rewrites it, migrates it, changes its customer-facing workflow, or touches its database. If a future business decision wants the website changed, that is a separate, explicitly-scoped project — not something any phase here does incidentally while "improving integration."

### 1.C — UI/IP Compliance Gate *(answers Gap 7)*

This stops being a mention inside the Bible and becomes a mandatory checklist attached to **every phase that changes anything the user sees** (this includes, but is not limited to, phases 65 "Settings/configuration UI," 87 "Location configuration UI," 112 "Platform admin console," and the final UI work in Stage 19). Any such phase's report must include a completed table:

| Element | Source / Inspiration | License | Usage | Modification | Risk | Decision |
|---|---|---|---|---|---|---|
| *(one row per UI element with any external inspiration or dependency)* | | | | | | |

Checked against: competitor visual similarity, copied layouts, copied assets, icons, images, fonts, illustrations, component licenses, dependency licenses, trademarks, proprietary source code, third-party design systems. Competitors (Odoo, Toast, Square, Lightspeed, Oracle MICROS, NCR, Clover, Material Design) are benchmarks for workflow and usability, never templates to copy. A phase with unresolved rows in that table cannot be marked PASS.

### 1.D — Phase Count Clarification & Release Bundling *(answers Gap 8)*

**100+ phases does not mean 100+ production deployments.** Each phase is a controlled engineering increment — some are coding, some are testing, some are schema work, some are pure research or documentation, some are security work, some are migration work, some are verification-only. Multiple adjacent phases within a stage are expected to ship together as one internal build wherever that's safe, tracked as a **Release Bundle**:

```
Stage  →  Phases  →  one or more Release Bundles  →  one or more actual deployments
```

Example: Stage 2 (phases 14–23) is one coherent behavior-preserving cleanup; it can reasonably ship as a single Release Bundle after its regression phase (22) passes, rather than ten separate releases. Stage 4's Table Transfer work (phases 33–36) likely needs its own bundle given its size and risk. The phase report for a stage's gate phase must state explicitly which Release Bundle(s) that stage's phases shipped as — this prevents both extremes: artificially inflating "100 deliveries" with no real progress, and silently batching so much together that a regression can't be traced back to a specific change.

### 1.E — Deployment Pipeline Policy *(answers Gap 9)*

From the first Release Bundle onward, every deployment moves through:

```
Development
    ↓
Test
    ↓
Staging
    ↓
Asmara Pilot (limited/off-hours validation on the real system)
    ↓
Production
```

Each promotion requires: a backup taken immediately before, a migration rehearsal already proven in Stage 3's phase 28 process, a documented rollback procedure specific to that release, release notes, a version number, and a post-deploy health verification. **No experimental development ever happens directly against the live production database or the live production terminal.** This policy is active starting Stage 2 (the first phase that touches running code) and remains permanent for the life of the product.

### 1.F — Disaster Recovery Standard *(answers Gap 10)*

Elevated from "recovery exists" to a defined standard, formalized in Stage 11 (phase 82) but referenced from Stage 0 onward for anything already backed up:

- Backup frequency and retention period, stated explicitly per data class (database, media, config, reports).
- Restore drill cadence — not just "we did one once."
- **RPO** (Recovery Point Objective — how much data can we afford to lose) and **RTO** (Recovery Time Objective — how fast must we be back up) stated as numbers, not aspirations.
- Named scenarios with a response plan for each: database corruption, POS terminal hardware failure and replacement, cloud/hosting outage, and — flagged explicitly as a later, not-yet-in-scope item — ransomware/security incident response planning, to be designed once Stage 5's security hardening is in place.

### 1.G — Immutable Audit Trail Standard *(answers Gap 13)*

The audit logging introduced in phase 43 (Stage 5) and expanded in phase 71 (Stage 9) must converge on one structured event shape, tamper-resistant for financial and security events specifically:

```
Audit Event
 ├── actor
 ├── tenant        (reserved field even pre-SaaS, per the governing directive's "SaaS-compatible decisions" clause)
 ├── location
 ├── terminal
 ├── timestamp
 ├── action
 ├── entity
 ├── before
 ├── after
 └── correlation ID
```

"Tamper-resistant" at this stage means: append-only storage, no update/delete path exposed through any API, and a periodic integrity check (e.g., hash-chaining consecutive events) — not necessarily a blockchain or external notarization, which would be over-engineering for this stage but should not be architecturally precluded later.

---

## 2. REVISED PHASE ROADMAP (v2.0)

Same 20-stage structure as v1.0, renumbered to fit the new phases the amendments above require. Every stage still ends with a gate; every gate still requires a phase report and CTO sign-off before the next stage begins.

### STAGE 0 — Production Safety & Baseline

1. Full backup capture (database once reachable, application build, source, migrations, media, local SQLite, config).
2. Verified restore drill into an isolated copy.
3. Functionality baseline certification against the FDD §37 regression list.
4. Hardware & printer topology documentation.
5. **Production Functionality Preservation Contract v1** produced *(Gap 1)* — the first full hardware/data/operations register, becomes a living document from here on.
6. **Stage 0 gate.**

### STAGE 1 — Complete Architecture Discovery

7. Production schema capture and diff against migration history.
8. Credential reconciliation (`db.js` vs `knexfile.js`/`.env`).
9. Vendor integration deep-dive (`pos.dftech.in`).
10. Website integration confirmation (image upload + reservation flow, with the site's own operator).
11. GH_TOKEN scope check.
12. **Website Freeze Policy formally declared and communicated** *(Gap 6)* — the boundary is written down before any integration work begins, not discovered informally later.
13. Security threat model.
14. **Stage 1 gate** — publish `Architecture Bible v2.0 — VERIFIED BASELINE`.

### STAGE 2 — Core Codebase Remediation *(behavior-preserving only)*

15. JWT secret fix.
16. Database credential fix.
17. CORS lockdown.
18. Auth-middleware gap closure (starting with `tables.js`).
19. HTTP-verb correction (GET-based mutations → correct verbs).
20. Dead-code quarantine (Redis, GraphQL, Nisarga-legacy).
21. Structured logging & error handling baseline.
22. Module boundary cleanup.
23. Stage 2 regression pass (full FDD §37 list, zero behavior change confirmed).
24. **Stage 2 gate** — first Release Bundle candidate per §1.D, deployed through the §1.E pipeline.

### STAGE 3 — Database & Domain Correction

25. Products/menu naming reconciliation.
26. **Real Reservation domain model, with explicit ownership decision** *(Gap 5)*: the POS owns the reservation domain; the website is treated as one input channel into it, not the other way around —
    ```
    Website  →  Integration Layer  →  Reservation Domain (owned by POS)
    ```
    not `Website → Reservation API → POS`. This determines the shape of the fix, not just that a fix happens.
27. Order data normalization (first pass, out of JSON blobs).
28. Constraints & indexes.
29. Authoritative migration set.
30. Migration rehearsal against a full production data copy.
31. **Stage 3 gate.**

### STAGE 4 — Transaction & Order Engine Hardening

32. Explicit order state machine.
33. **Table Transfer — data model & domain operation, designed for partial transfer from day one** *(Gap 2)*: the atomic `transferTable(orderId, sourceTableId, destinationTableId, userId, terminalId)` operation is built now for a full-order move, but the underlying data model (order ↔ order-item ↔ table association) must not preclude splitting a subset of items/guests to a second table later —
    ```
    Table 10, 8 guests, 12 items
              ↓
    4 guests → Table 15   |   4 guests remain → Table 10
    ```
    Partial transfer is explicitly **not implemented in this phase** — only guaranteed not to require a schema redesign when it is.
34. Table Transfer — occupied-destination handling (cancel/merge decision flow).
35. Table Transfer — audit & notification.
36. Table Transfer — concurrency safety (row locking / optimistic versioning).
37. **Payment domain model** *(Gap 3)* — formalized beyond a simple adapter interface into explicit entities: Payment Intent, Payment Attempt, Payment Transaction, Payment Method, Provider, Provider Reference, Settlement, Refund, Void, Reversal.
38. **Payment reconciliation & idempotency** *(Gap 3)* — the specific failure mode the CTO flagged gets a dedicated design: if a card terminal reports success but the POS never receives that confirmation (network timeout before the response arrives), the system must NOT assume failure and allow a second charge. This phase builds the reconciliation path: every payment attempt carries a provider reference and idempotency key, and an ambiguous-outcome attempt is resolved by querying the provider for the attempt's actual status before any retry is permitted, with the order held in an explicit "payment pending reconciliation" state in the meantime.
39. Order idempotency (create, kitchen submission).
40. Kitchen routing refactor (Product → Preparation Rule → Kitchen Station).
41. Cash register / X-Z report hardening (transactional, idempotent, immutable once closed).
42. **Explicit concurrency test suite** *(Gap 14)* — the real restaurant scenarios named by the CTO, run as actual tests, not theoretical descriptions:
    - POS 1 opens Table 5 while POS 2 opens Table 5
    - POS 1 transfers Table 5 → Table 8 while POS 2 modifies Table 5
    - POS 1 pays an order while POS 2 attempts payment on the same order
    - POS 1 sends an order to the kitchen while POS 2 sends the same order to the kitchen
43. Stage 4 end-to-end test (full critical path including table transfer and a payment-reconciliation scenario).
44. **Stage 4 gate** — likely its own Release Bundle given size/risk, per §1.D.

### STAGE 5 — Authentication & Authorization Security

45. RBAC data model (Owner/Manager/Cashier/Waiter/Kitchen, configurable).
46. Per-route authorization audit, enforced server-side.
47. Session/token hardening.
48. Audit logging, conforming to the §1.G immutable event shape.
49. Auth abuse protection (rate limiting, lockout).
50. **Stage 5 gate.**

### STAGE 6 — POS Hardware Architecture

51. Printer abstraction layer.
52. Cash drawer & customer-display abstraction (including the `nodeIntegration: true` fix).
53. Hardware failure handling as first-class operational states.
54. **Stage 6 gate.**

### STAGE 7 — Offline-First Foundation

55. Durable local outbox (UUID, tenant/location/terminal stamp, sequence, idempotency key).
56. Terminal identity.
57. Sync engine v1.
58. Conflict handling strategy.
59. Offline failure-mode testing (simulated network loss mid-service).
60. **Stage 7 gate.**

### STAGE 8 — Configuration & Tenant-Ready Foundation

61. Configuration hierarchy schema (Platform → Tenant → Brand → Location → Terminal).
62. De-hardcode restaurant-specific behavior into configuration.
63. **Inventory domain separation** *(Gap 4)* — explicitly split, at the domain-model level, `Product Availability` (is this item sellable right now — already needed for day-one POS operation) from `Inventory Management` (stock quantity, stock adjustment, ingredient inventory, recipe/BOM, wastage, purchasing, suppliers, stock movement — the full future system). Only availability is implemented now; the schema is shaped so the full inventory system can be added in Stage 19 without a core redesign.
64. Terminal registration & management.
65. Settings/configuration UI — **subject to the UI/IP Compliance Gate (§1.C).**
66. **Stage 8 gate.**

### STAGE 9 — Reporting / Audit / Financial Integrity

67. Reports from source-of-truth (transactional data, not PDF-as-record).
68. Financial reconciliation tooling.
69. Audit trail UI/export, built on the §1.G immutable event shape.
70. **Data export / portability** *(Gap 12)* — a documented, working export path for products, categories, customers, orders, reports, and configuration, in a restaurant-owned format (e.g. CSV/JSON), independent of any future SaaS billing relationship. This exists for Asmara's own operational benefit now (and doubles as the mechanism a SaaS tenant would later use).
71. **Stage 9 gate.**

### STAGE 10 — Integration Architecture

72. Website adapter — built strictly within the §1.B freeze boundary.
73. Price synchronization (POS → Website).
74. Payment provider adapter framework, built on the Stage 4 payment domain model.
75. Vendor integration decision (`pos.dftech.in`: formalize, renegotiate, or replace).
76. **Stage 10 gate.**

### STAGE 11 — Observability / Reliability / Recovery

77. Centralized structured logging.
78. Health checks & metrics.
79. Durable job/queue system (replaces local cron).
80. **Disaster Recovery Plan formalized** *(Gap 10)* — the §1.F standard's numbers (RPO/RTO, retention, drill cadence) get written down and tested for real, covering database corruption, terminal replacement, and cloud/hosting outage; ransomware/security-incident planning explicitly logged as a follow-on item once Stage 5 hardening is proven in production.
81. **Stage 11 gate.**

### STAGE 12 — Asmara Production Certification

82. Full FDD/TDD regression.
83. Load/performance sanity test (simulated fully-occupied Friday night).
84. **Preservation Contract final verification** *(Gap 1)* — every register item from phase 5's contract re-checked against the now-hardened system; nothing may have quietly disappeared across 80+ phases of change.
85. **Deployment pipeline formally in force** *(Gap 9)* — confirmation that every change from here forward, including any Stage 13+ SaaS work, goes through Development → Test → Staging → Asmara Pilot → Production with no exceptions.
86. **Production Certification** — milestone: *Asmara POS, hardened*. A legitimate, complete stopping point if the goal is only a bulletproof Asmara POS, per the Governing Directive in §0.

### STAGE 13 — SaaS Foundation

87. Multi-tenant data model (`tenant_id`/`location_id`/`terminal_id` enforced at the query layer).
88. Platform identity service (tenant-aware authentication).
89. **Tenant lifecycle model** *(Gap 11)*, defined before billing exists:
    ```
    Tenant → Trial → Active → Suspended → Cancelled → Archived
    ```
    plus tenant provisioning, tenant deletion, tenant data export (building on phase 70), tenant-level backup and recovery, plan limits, and feature flags.
90. Tenant provisioning & onboarding mechanics.
91. Asmara migrated into the tenant model as Tenant #1, zero-downtime.
92. Billing/plan scaffolding (data model only).
93. **Stage 13 gate.**

### STAGE 14 — Multi-POS / Multi-Terminal

94. Concurrent-terminal integrity.
95. Real-time terminal sync.
96. **Stage 14 gate.**

### STAGE 15 — Multi-Location

97. Location entity & scoping.
98. Cross-location reporting.
99. Location configuration UI — **subject to the UI/IP Compliance Gate.**
100. **Stage 15 gate.**

### STAGE 16 — Enterprise Restaurant Groups

101. Brand hierarchy.
102. Enterprise role/permission scoping.
103. **Stage 16 gate.**

### STAGE 17 — Globalization

104. Multi-currency & multi-language.
105. Country-specific tax/fiscalization framework.
106. Timezone-aware operations.
107. **Stage 17 gate.**

### STAGE 18 — SaaS Operations / Billing / Plans

108. Subscription billing (working, on top of phase 92's scaffolding and phase 89's tenant lifecycle).
109. Platform admin console — **subject to the UI/IP Compliance Gate.**
110. Self-serve tenant signup.
111. **Stage 18 gate.**

### STAGE 19 — Advanced Platform

112. Inventory management (full build-out on the phase 63 domain separation): stock quantity, adjustment, ingredient inventory, recipe/BOM, wastage, purchasing, suppliers, stock movement.
113. Loyalty & customer marketing.
114. Delivery/online-ordering channel integrations.
115. Accounting integration adapters.
116. AI restaurant-assistant layer.
117. **RestaurantOS v1.0 commercial launch readiness gate** — final UI work here subject to the UI/IP Compliance Gate; final Disaster Recovery and Preservation Contract re-verification against the complete platform.

---

## 3. VERDICT TRACKING TABLE (for the CTO to fill in per stage)

| Stage | Gate Phase | CTO Verdict | Date | Notes |
|---|---|---|---|---|
| 0 | 6 | | | |
| 1 | 14 | | | |
| 2 | 24 | | | |
| 3 | 31 | | | |
| 4 | 44 | | | |
| 5 | 50 | | | |
| 6 | 54 | | | |
| 7 | 60 | | | |
| 8 | 66 | | | |
| 9 | 71 | | | |
| 10 | 76 | | | |
| 11 | 81 | | | |
| 12 | 86 | | | **Legitimate stopping point — see §0** |
| 13 | 93 | | | |
| 14 | 96 | | | |
| 15 | 100 | | | |
| 16 | 103 | | | |
| 17 | 107 | | | |
| 18 | 111 | | | |
| 19 | 117 | | | |

---

## 4. IMMEDIATE NEXT STEP

Nothing changes about the current blocking status: Phase 0 (now phases 1–6 in this v2.0 numbering) still cannot complete until the live production database backup happens outside this sandboxed session, and Stage 1's discovery items still need real answers (schema truth, `pos.dftech.in`'s actual nature, GH_TOKEN scope) before Stage 1's gate — now phase 14 — can pass.

No code changes happen anywhere in Stages 0–1. This document is submitted for CTO freeze before Stage 2 (phase 15, the JWT secret fix) becomes the first line of code actually touched.
