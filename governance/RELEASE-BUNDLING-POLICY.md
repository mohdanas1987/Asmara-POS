# RELEASE-BUNDLING-POLICY.md
**Governance item:** §1.D, Master Development Specification v2.0
**Status:** ACTIVE

## Policy statement

**100+ phases does not mean 100+ production deployments.** A phase is a controlled engineering increment — some are coding, some are testing, some are schema work, some are pure research or documentation, some are security work, some are migration work, some are verification-only. Multiple adjacent phases within a stage ship together as one internal build wherever that's safe:

```
Stage  →  Phases  →  one or more Release Bundles  →  one or more actual deployments
```

## Why this exists

Without this rule, two opposite failure modes are equally likely: inflating the appearance of progress with dozens of trivial "releases" that don't individually matter, or the reverse — silently batching so much work into one release that a regression can't be traced back to the specific change that caused it. Every gate phase's report must state explicitly which Release Bundle(s) that stage shipped as.

## Proposed bundling map (Stages 0–4, to be extended as later stages are reached)

| Stage | Phases | Proposed Release Bundle(s) | Reasoning |
|---|---|---|---|
| 0 | 1–6 | **Bundle 0.1** — no production deployment; this stage produces backups and documentation only. | Nothing here is a code change; there is nothing to "release." |
| 1 | 7–14 | **Bundle 1.1** — no production deployment; discovery and documentation only, ends with `Architecture Bible v2.0`. | Same reasoning as Stage 0. |
| 2 | 15–23 | **Bundle 2.1** — one internal build covering all of JWT fix, DB credential fix, CORS lockdown, auth-middleware gaps, HTTP-verb correction, dead-code quarantine, logging, module cleanup. | All nine phases are behavior-preserving and low-risk individually; bundling them means one regression pass (phase 23) covers all of them rather than nine separate ones, and they're small enough that if something regresses, the bundle is still narrow enough to bisect by phase. |
| 3 | 25–30 | **Bundle 3.1** — schema/domain correction, deployed only after phase 30's migration rehearsal passes. | Schema changes are inherently higher-risk; this bundle gets its own dedicated staging→pilot→production run per the Deployment Pipeline Policy (§1.E), not folded into Bundle 2.1. |
| 4 | 32–43 | **Bundle 4.1** (order state machine, payment domain model, idempotency, kitchen routing, register hardening) + **Bundle 4.2** (Table Transfer specifically: phases 33–36) as a separate, smaller bundle. | Table Transfer is a brand-new, customer-facing capability with its own risk profile (per the CTO review) and deserves isolated rollback capability independent of the rest of Stage 4's hardening work. |

Bundling proposals for Stages 5 onward will be added to this table as those stages are actually reached — proposing them this far in advance would be guessing ahead of the discovery those stages themselves are meant to produce.

## Rule for future stages

Before any stage's phases begin implementation, its bundling proposal is added to this table and reviewed alongside that stage's own gate — not decided informally mid-stage.
