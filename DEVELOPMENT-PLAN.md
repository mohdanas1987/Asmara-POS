# ASMARA POS — Development Plan
**Companion to:** `01-ASMARA-POS-FDD-v1.0.md`, `02-ASMARA-POS-TDD-v1.0.md`, `03-ASMARA-POS-ENGINEERING-BIBLE-v1.1.md`
**Prepared by:** Claude (Implementation Agent)
**Date:** 2026-09-04
**Status:** DRAFT — awaiting Business Owner / ChatGPT CTO review before Phase 0 execution begins

---

## 0. How this plan reads against the Bible

Per Engineering Bible §24, every phase starts by reading Bible → FDD → TDD → previous phase report, then works only inside the current phase's scope (§32–46), and closes with the report format in §26 and a PASS / CONDITIONAL PASS / FAIL verdict (§29–31) that is provisional until ChatGPT CTO sign-off (§27).

This document is that first read-through, applied to what is *actually* known about this specific codebase today, plus the concrete plan for the two phases the Bible makes mandatory before any structural work: **Phase 0 (Production Safety & Baseline)** and **Phase 1 (Architecture Discovery)**.

I am not starting Phase 2 or later. Per the Bible's final command (§50) and your own instruction, substantial structural change waits for your review and CTO PASS on Phase 0/1 evidence.

---

## 1. Where we already are, honestly

Before this conversation, two documents already existed in the project folder from prior work:

- `Asmara_POS_Architecture_Bible_v1.0.md` — built from inspecting the packaged `Asmara-POS.zip` at the file/structure level.
- `Asmara_POS_Architecture_Bible_v1.1_Verification_Addendum.md` — built by actually extracting `app.asar` and reading the real backend source (every route file, the two DB config files, the auth middleware, the Reservation/Report models, the compiled frontend bundle) line by line, and correcting/hardening several of v1.0's "inferred" or "not yet proven" findings into "confirmed from code."

That work already satisfies a meaningful slice of **Phase 1** as the Bible defines it (§34: architecture map, API map, DB map, dependency map, security map, legacy map, data-flow map). Specifically, already confirmed from code, not guesswork:

- The full current API surface, route by route, including exactly which state-changing endpoints have no authentication at all (`tables.js` has none; several GET-based mutations elsewhere are unauthenticated too).
- The JWT secret is a hardcoded literal (`'whateverItWas'`) shared across two files — trivially forgeable.
- `backend/db.js` hardcodes the live production MySQL host/user/database/password as source literals, separately from the `.env`-driven config `knexfile.js` uses for migrations — two credential sources that may or may not agree.
- Redis and GraphQL are not installed dependencies in the shipped build at all — confirmed dead code, not merely "unclear role."
- The `Reservation` model is a byte-for-byte copy of the `Report` model pointed at the `reports` table with a broken relation; `GET /tables/reservations` therefore returns report rows mislabeled as reservations. There is no reservation persistence in this backend today.
- Two separate external systems exist where v1.0 originally saw one blurry "website integration": `asmara-eindhoven.nl` (called only from the frontend, for image upload/CDN) and `pos.dftech.in` (called only from the backend, for product sync **and** for uploading the entire local SQLite database as a "backup" to the vendor's server).
- A `GH_TOKEN` is present in the shipped `.env` (value not inspected) for the GitHub-based auto-updater — scope unverified.
- The customer-display Electron window runs with `nodeIntegration: true`, inconsistent with the main POS window's `false`.

**What is still missing from Phase 1**, and cannot be closed by reading the package alone — this is the honest gap, not a formality:

- The actual current production database schema, row counts, and whether it matches `db.js`'s hardcoded credentials or `.env`'s `knexfile.js` credentials.
- Whether the live restaurant's currently-running installation is this exact build (v5.0.4, matching this zip) or has since diverged.
- Runtime confirmation of what `pos.dftech.in` actually is (a shared vendor backend across multiple POS customers, or dedicated to Asmara) and what data it already holds.
- The `GH_TOKEN`'s actual scope.
- Printer/cash-drawer/customer-display hardware topology at the physical restaurant (model numbers, connection type, driver quirks) — nothing in the package tells us this.
- Whether the live site currently reachable at the physical terminal binds `server.js` to `localhost` only or is exposed more broadly on the restaurant's LAN.

None of these gaps block starting Phase 0. Some of them (schema truth, `pos.dftech.in` nature) are exactly what Phase 0's verified backup step and a closing round of Phase 1 discovery should resolve together.

---

## 2. Phase 0 — Production Safety & Baseline (next action, this plan's focus)

Full checklist lives in `phases/phase-00/PHASE-00-PLAN.md`. Summary of scope and — importantly — **what I can and cannot do from here without further authorization**:

**Already in hand, usable as part of the baseline immediately:**
- `Asmara-POS.zip` — a snapshot of the packaged installer/build (Electron app, `app.asar`, source, migrations, current `client/build`). This satisfies most of Bible §3.2/FDD §3.2's "preserve installer / build / source / migrations" as of the date this zip was produced, *provided the restaurant's live install hasn't since been updated past v5.0.4* — that needs confirming, not assuming.

**Requires a decision from you before I touch it — genuinely blocked, not just cautious:**
- A full logical backup (`mysqldump` or equivalent) of the **live production MySQL database** at `srv1399.hstgr.io`. The credentials to do this are already known (extracted from `db.js` during Phase 1 discovery), and a read-only dump is non-destructive by nature — but this is a live financial system at a real operating restaurant, reachable from this session only if this session's network egress permits an outbound MySQL connection to that host, and I should not initiate contact with a live production database serving real dinner service tonight without you explicitly telling me to proceed. See the question at the end of this document.
- Any live-terminal artifacts I don't already have from the zip: current `offline.sqlite` state as it exists *right now* on the restaurant's machine (the zip's copy is a point-in-time snapshot, already stale the moment new orders are entered), current `tmp/reports`, `tmp/products`, `tmp/notes` contents, current printer configuration, and confirmation of the exact build/version currently running at the restaurant. I have no path to the physical POS terminal at all — only what was packaged into the zip you gave me. If that machine isn't reachable through this session, backing it up requires either physical/remote access to it, or you exporting a fresh copy the same way you produced the original zip.

**No exceptions per Bible §3**: I will not modify any production-adjacent code, schema, or configuration until backup + verified restore for whatever is in scope is complete and documented.

---

## 3. Phase 1 — completing what's left (after Phase 0, or in parallel where safe)

Once Phase 0's backup scope is settled, closing Phase 1 means:
1. Comparing the production DB schema (once we can see it) against the migration history already flagged as inconsistent in the Bible.
2. Getting a straight answer on `pos.dftech.in` — ideally the simplest path is asking the restaurant/vendor directly rather than more code archaeology, since the package alone has told us everything it can.
3. Confirming the `GH_TOKEN` scope (this can be checked safely via GitHub's API without touching production — I can do this on request without further authorization, since it only reads token metadata).
4. A hardware inventory conversation with whoever runs the restaurant's floor (printer models, cash drawer, customer display) — not derivable from source code at all.

I'll fold all of this into an updated `Asmara_POS_Architecture_Bible_v2.0.md` — the "VERIFIED BASELINE" the Bible's §34 calls for — once it's complete, rather than producing more incremental addenda.

---

## 4. Phase roadmap status (Bible §32, for tracking)

| Phase | Name | Status |
|---|---|---|
| 0 | Production Safety & Baseline | **NOT STARTED — this plan is the proposal; blocked on your go-ahead for live DB access** |
| 1 | Complete Architecture Discovery | **PARTIALLY COMPLETE** — package-level and source-level discovery done (v1.0 + v1.1 addendum); DB-schema-truth, hardware, and vendor-integration questions remain open |
| 2–19 | Everything else | **NOT STARTED** — correctly so, per Bible §7 and §50: no structural change before Phase 0/1 sign-off |

---

## 5. The one decision I need from you before executing Phase 0

Everything in Phase 0 that touches only the `Asmara-POS.zip` you already gave me, I can do without further permission — it's a static file, no live system involved.

The part that actually needs your explicit yes/no: **should I attempt a read-only backup connection to the live production MySQL database** using the credentials found in `db.js`, from this session? This is the single biggest concrete step toward real Phase 0 completion (Bible §3.1/FDD §3.1's "full database backup, verified restore"), but it means an automated agent reaching into a real restaurant's live financial database over the network, tonight or whenever this runs, which is exactly the kind of action the Bible tells me to stop and flag (§50) rather than assume.

If yes, I'd also want to confirm: is dinner service currently running (per the earlier discovery, Asmara operates dinner service) — a `mysqldump` is read-only and low-load, but I'd rather do it in a quiet window than guess.
