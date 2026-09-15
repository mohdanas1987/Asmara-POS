# Governance Artifacts — §1.A through §1.G

**Source:** Section 1 ("Standing Governance Additions"), Master Development Specification v2.0.
**What this is:** the actual, filled-in artifacts for each governance item — not more planning-about-planning. Everything here is new scaffolding for the project; nothing in this folder modifies the live Asmara POS application code, so it doesn't require Stage 2's code-change gate to produce.

| Item | File | What it is |
|---|---|---|
| §1.A | `PRESERVATION-CONTRACT.md` | Real hardware/data/operations inventory, built from the code-level Architecture Bible discovery, with every line marked confirmed-from-code or still-needs-live-confirmation. |
| §1.B | `WEBSITE-FREEZE-POLICY.md` | The formal, active policy — what's permitted (inspect/document/integrate/sync price) and what's not. |
| §1.C | `UI-IP-COMPLIANCE-GATE-TEMPLATE.md` | The reusable checklist/table every future UI-touching phase must fill in before it can pass. |
| §1.D | `RELEASE-BUNDLING-POLICY.md` | The policy plus a concrete bundling proposal for Stages 0–4. |
| §1.E | `DEPLOYMENT-PIPELINE-POLICY.md` | Dev → Test → Staging → Asmara Pilot → Production, with the promotion checklist. |
| §1.F | `DISASTER-RECOVERY-STANDARD.md` | Proposed backup/retention/RPO/RTO numbers and named scenario response plans, marked DRAFT pending owner/CTO confirmation. |
| §1.G | `audit-trail/` | A **working, runnable** reference implementation — not just a document. See `audit-trail/README.md` to test it yourself with `node demo.js`. |

## What's still open

- §1.A's physical hardware register (printer models/connections) needs restaurant staff input — not resolvable from code.
- §1.F's numeric targets (RPO/RTO, backup frequency) are proposals, not confirmed commitments — they need an owner/CTO decision.
- Everything here assumes the Phase 0 live-database-backup blocker from before is still unresolved. None of these artifacts required that backup to produce, and none of them are blocked waiting on it either — they can be reviewed now.

## What this is not

This is not Stage 0 or Stage 1 phase completion. Those phases (1–14 in the v2.0 numbering) still require the live-system work — schema capture, vendor deep-dive, hardware confirmation, etc. — that only becomes possible once the database backup question is resolved. This governance folder is the §1 standing-rules layer that sits above and alongside those phases, buildable independently of them.
