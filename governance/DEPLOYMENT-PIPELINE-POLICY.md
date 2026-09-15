# DEPLOYMENT-PIPELINE-POLICY.md
**Governance item:** §1.E, Master Development Specification v2.0
**Status:** ACTIVE from Stage 2 onward (the first stage that touches running code); permanent for the life of the product.

## The pipeline

```
Development
    ↓
Test
    ↓
Staging
    ↓
Asmara Pilot   (limited/off-hours validation on the real system)
    ↓
Production
```

## Promotion checklist (required at every arrow above)

- [ ] **Backup taken immediately before promotion**, scoped to whatever that release touches (database, config, media).
- [ ] **Migration rehearsal already proven** via the Stage 3/phase 30 process, for any release that includes a schema change.
- [ ] **Rollback procedure documented**, specific to this release — not a generic "we can probably restore from backup" statement.
- [ ] **Release notes written** — what changed, referencing the phase number(s) and Release Bundle (per §1.D) it corresponds to.
- [ ] **Version number assigned** and recorded.
- [ ] **Post-deploy health verification** — a defined, repeatable check (not "it looked fine") confirming the release is actually healthy in its new environment before moving to the next stage of the pipeline.

## Asmara Pilot stage — specifically

Because Asmara is a live, revenue-generating restaurant, "Staging" is not sufficient validation on its own before "Production." The Asmara Pilot stage means: the release runs against the real system, but during a deliberately chosen low-risk window (off-hours, or a quiet period identified with restaurant staff — not blindly during Friday dinner service), with a human watching for the specific things that release changed, before it's considered load-bearing for a normal service night.

## The absolute rule

**No experimental development ever happens directly against the live production database or the live production terminal.** This is not a preference — every stage of this pipeline exists specifically to prevent that. Any deviation (e.g., "just quickly checking something in prod") requires the same authorization discipline as any other production access decision in this project (see the Phase 0 live-DB-backup precedent: explicit owner sign-off, not assumed).

## Scope note

This policy governs the POS codebase's own releases. It does not apply to, and does not create any new pathway toward, the website — see `WEBSITE-FREEZE-POLICY.md` (§1.B). The website has no pipeline here because this project has no deployment authority over it at all.
