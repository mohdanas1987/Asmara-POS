# UI-IP-COMPLIANCE-GATE-TEMPLATE.md
**Governance item:** §1.C, Master Development Specification v2.0
**Status:** ACTIVE TEMPLATE — copy this into any phase report for a phase that changes anything the user sees (currently scheduled at minimum for phases 65, 99, 109, and 117; any other UI-touching phase discovered along the way inherits this requirement automatically).

## When this applies

Any phase that adds, redesigns, or meaningfully restyles a screen, component, icon set, illustration, font choice, or layout the end user (restaurant staff, tenant admin, or platform admin) will see.

## Required table (one row per UI element with any external inspiration or dependency)

| Element | Source / Inspiration | License | Usage | Modification | Risk | Decision |
|---|---|---|---|---|---|---|
| *(e.g. "order-panel layout")* | *(e.g. "general POS industry convention — no single competitor")* | *(n/a, or the specific license if a component library is used)* | *(how it's used in this build)* | *(what was changed from the inspiration, if anything)* | *(none / low / medium / high, with reasoning)* | *(approved as-is / approved with changes / rejected, redesigned)* |

## Checklist (must all be explicitly considered, not skipped)

- [ ] Competitor visual similarity — does any screen read as a copy of Odoo, Toast, Square, Lightspeed, Oracle MICROS, NCR, or Clover specifically, rather than a shared industry convention?
- [ ] Copied layouts — is any screen's structure lifted wholesale from a specific competitor screenshot rather than designed from the ASMARA POS design system (TDD §37)?
- [ ] Copied assets — images, illustrations, icon sets: original, licensed, or public-domain only.
- [ ] Fonts — licensed for this use (commercial product, not just personal/eval).
- [ ] Component libraries / third-party design systems — license terms checked and compatible with commercial use.
- [ ] Trademarks — no competitor names, logos, or trade dress reproduced, referenced, or implied.
- [ ] Proprietary source code — no UI code copied from a competitor's (leaked, decompiled, or otherwise obtained) source.
- [ ] Dependency license inventory updated (cross-reference TDD §39).

## Rule

A phase with any unresolved row in the table above, or any unchecked box with no documented reason it doesn't apply, **cannot be marked PASS**. This is an engineering compliance process per Bible §19 — it reduces obvious copying and licensing risk, it does not constitute a legal opinion. Commercially significant releases (Stage 18–19) should still get professional legal/IP review before public launch.
