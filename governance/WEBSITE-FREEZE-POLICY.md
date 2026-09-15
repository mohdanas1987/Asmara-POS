# WEBSITE-FREEZE-POLICY.md
**Governance item:** §1.B, Master Development Specification v2.0
**Status:** ACTIVE — in force for the life of this project unless explicitly amended by the business owner.

## Policy statement

> **NO DIRECT WEBSITE DEVELOPMENT IS AUTHORIZED.**

`asmara-eindhoven.nl` is an **External System** reached only through an **Optional Integration**. It is never a dependency of the POS core, and no phase of this project modifies it.

## Permitted actions

- **Inspect** — read the site's public pages, its published menu, and (with the operator's cooperation) how its reservation form and image endpoints behave.
- **Document** — record findings in the Architecture Bible / integration profile, clearly labeled confirmed-from-code vs. confirmed-live vs. inferred.
- **Integrate** — build and maintain the POS-side adapter (Stage 10/phase 72) that calls the website's existing API, exactly as that API already exists.
- **Synchronize price** — the one specific, explicitly-approved data flow (Stage 10/phase 73): POS → Website product pricing, through the adapter above.

## Prohibited actions

- Redesigning, rewriting, or restyling any part of the website.
- Migrating the website to new infrastructure.
- Changing its customer-facing workflow (menu browsing, reservation form, contact form).
- Modifying its database, directly or through an undocumented side channel.
- Introducing a new dependency the website's own team didn't ask for.
- Treating the website as if it were part of the POS's deployment pipeline (§1.E) — it has its own, separate lifecycle, entirely outside this project's scope.

## Why this exists

The website is customer-facing, revenue-generating infrastructure the restaurant already relies on today, built and (presumably) maintained by a separate party. This project's mandate is the POS. Touching the website — even with good intentions — creates a second live system this project would be responsible for without the context, access, or authorization to do so safely. If a future business decision wants the website changed, that becomes its own explicitly-scoped project with its own Phase 0.

## Escalation

If any phase's discovery work surfaces a reason the website genuinely needs to change (e.g., its reservation form has no real backend and customers believe bookings are being received when they aren't), that finding is logged and raised to the business owner as a `DEFERRED / DISCOVERED ITEM` — it is not acted on unilaterally, however clear the technical case seems.
