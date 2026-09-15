# PHASE 0 — Production Safety & Baseline
**Status:** PROPOSED — not yet executed
**Governing documents read before drafting this:** Engineering Bible v1.1 (§3, §33), FDD v1.0 (§3), TDD v1.0 (§5)
**Rule:** No architecture modification happens in this phase. This phase only backs up and verifies. Nothing here is destructive.

---

## 1. Scope

Per Bible §33 / FDD §3, Phase 0 must deliver: verified backups, a documented restore procedure, a current build archive, a functionality baseline, a hardware baseline, and a product/media baseline.

## 2. Backup targets and current status

| # | Target | Source | Status | Notes |
|---|---|---|---|---|
| 1 | Packaged application (installer/build) | `Asmara-POS.zip` provided by user | **HAVE** — stored in the project folder | Point-in-time snapshot, app v5.0.4. Needs confirmation this matches the version currently running live. |
| 2 | Application source (`app.asar` contents) | Extracted from the zip above | **HAVE** — extracted during architecture discovery | Includes `backend/`, `main.js`, `preload.js`, migrations, models, routes |
| 3 | Frontend build (`client/build`) | Inside `app.asar` | **HAVE** — part of the extraction | Compiled React bundle, no source tree |
| 4 | Migrations folder | Inside `app.asar` | **HAVE** | Already flagged as internally inconsistent — do not treat as schema truth |
| 5 | Local `offline.sqlite` | Inside the zip | **HAVE, BUT STALE** | This is a snapshot from when the zip was made, not the live file. Every order since then is not in it. |
| 6 | `tmp/reports`, `tmp/products`, `tmp/notes`, `tmp/temp` | Inside the zip | **HAVE, BUT STALE** | Same caveat as #5 — treat as historical sample, not current state |
| 7 | Production MySQL database (schema + data) | Live remote host `srv1399.hstgr.io` | **NOT DONE — BLOCKED ON AUTHORIZATION** | Credentials are known from `db.js`; a `mysqldump` is read-only and non-destructive, but reaching a live production financial database needs your explicit go-ahead, not an assumption. See open question in `DEVELOPMENT-PLAN.md` §5. |
| 8 | Live restaurant terminal's *current* filesystem state | Physical POS machine at Asmara restaurant | **NOT ACCESSIBLE FROM THIS SESSION** | No path exists from here to that machine. Needs either: you exporting a fresh package the same way as before, or physical/remote access being arranged separately. |
| 9 | Printer / cash drawer / customer display configuration | Physical hardware at the restaurant | **NOT ACCESSIBLE — needs a conversation with restaurant staff/owner**, not code archaeology | Model numbers, connection type (USB/network/serial), driver names |
| 10 | GitHub auto-update repo/release history | GitHub, via `GH_TOKEN` referenced in `.env` | **NOT DONE** | Safe to check (read-only) once you confirm I should use the token found in the package |

## 3. Verified-restore requirement (Bible §3, "no exceptions")

For each backup target actually captured, "backed up" is not enough — Phase 0 is not complete until each one has a **documented, verified restore path**:

- **Application/source/frontend/migrations (targets 1–4):** verify by re-extracting the archived zip into a clean directory and confirming `app.asar` unpacks cleanly and the file tree matches what was inventoried during discovery (already effectively done once; will re-verify as a formal step before closing this phase).
- **`offline.sqlite` / `tmp/*` (targets 5–6):** verify by opening the SQLite file with a schema/row check and spot-checking a sample of the report PDFs and product images against their filenames — confirms the archive isn't corrupted, not that it's current.
- **Production database (target 7):** once authorized and captured, verify by restoring the dump into a *throwaway, isolated* database (never back into production) and confirming row counts and a handful of spot-checked records (e.g., a specific known order, a specific product) match what a live read-only query against production returns.
- **Live terminal state (target 8):** cannot be verified until it can be captured at all.
- **Hardware (target 9):** "verified" here means a written inventory confirmed by the restaurant, not a technical restore.

## 4. What this phase explicitly does NOT do

- No schema changes.
- No code changes to `db.js`, `auth.js`, or any other file identified as a security issue — those are Phase 5 (Authentication & Authorization Security) and Phase 3 (Database & Domain Correction) scope, not Phase 0.
- No rotation of the JWT secret or DB credentials yet — rotating the DB password before an API layer exists to mediate access would just break the live app; rotating the JWT secret is low-risk and could arguably happen early, but per Bible §4 ("no blind rewrite") and §23 ("no uncontrolled scope creep") it's logged here as a **Phase 5 candidate for early execution**, not done inside Phase 0.
- No connection to `pos.dftech.in` or `asmara-eindhoven.nl` beyond what's already been read from static code.

## 5. Phase 0 exit criteria

Phase 0 is PASS only when:
- [ ] Every row in the table above is either "HAVE + verified" or explicitly deferred with your sign-off and a documented reason.
- [ ] The production database backup (if authorized) has been captured and restore-verified into an isolated copy.
- [ ] A written functionality baseline exists: a plain description of what currently works end-to-end (login → open register → table → order → kitchen → payment → receipt → X/Z → close), based on the FDD §37 regression list, confirmed against what the code shows rather than assumed.
- [ ] This document is updated with actual dates/evidence and a final PASS / CONDITIONAL PASS / FAIL verdict per Bible §26/§29–31, then held for your and the "ChatGPT CTO" review before Phase 1 is declared closed and Phase 2 begins.

## 6. Immediate next step

Awaiting your answer to the one open question in `DEVELOPMENT-PLAN.md` §5 (live production DB backup authorization) before this phase can move from "proposed" to "in progress."
