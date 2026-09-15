# ASMARA POS
## ENGINEERING BIBLE v1.1 — The Permanent Engineering & Governance Contract

**Product:** ASMARA POS / Future Restaurant SaaS Platform
**Current Production Customer:** Asmara Restaurant, Eindhoven
**Status:** AUTHORITATIVE
**Version:** 1.1

---

## 1. THE MOST IMPORTANT RULE

ASMARA POS IS A REAL PRODUCTION BUSINESS SYSTEM. It is not a coding exercise. It is not a prototype. It is not a demo. It is not a disposable project. It will be used to operate real restaurants and ultimately become a commercial SaaS product.

Therefore:

- Data integrity > feature speed
- Production safety > refactoring enthusiasm
- Correct architecture > quick implementation
- Evidence > assumptions

## 2. PROTECTED BASELINE

The current production system is the protected baseline. Never casually remove: products, categories, images, orders, tables, kitchen printing, receipt printing, cash drawer, customer display, payment functionality, reports, customers, reservations, existing operational behaviour.

## 3. PHASE 0 IS MANDATORY

Before changing production-related code:

**Backup** — database, application, configuration, media, products, categories, current build.

**Verify** — backup restoration, application restoration, product/media integrity, critical POS functionality.

No exceptions.

## 4. NO BLIND REWRITE

Never rewrite the entire POS simply because the current architecture is imperfect. First understand it. Then isolate it. Then improve it. Then replace components only when justified.

## 5. CURRENT WEBSITE IS PROTECTED

The connected website is currently OUT OF SCOPE for modification. The POS must treat it as an external integration. Do not redesign or alter it without explicit approval. Initial integration priority: price synchronization.

## 6. SAAS-READY BY DESIGN

Every architectural decision must be evaluated against:

```
Tenant
 ↓
Brand
 ↓
Location
 ↓
Terminal
 ↓
User
```

Even if the feature is currently used by only one restaurant.

## 7. DO NOT BUILD SAAS TOO EARLY

The immediate mission is: make the existing Asmara POS extremely strong first. Then:

```
Production POS
 ↓
Configurable POS
 ↓
Multi-POS
 ↓
Multi-location
 ↓
Multi-tenant SaaS
```

## 8. TABLE TRANSFER IS CORE

Table transfer is now an official core capability. Requirements: transfer active order, preserve order identity, preserve kitchen state, preserve customer, preserve payment state, update table occupancy, audit transfer, prevent accidental overwrite, handle occupied destination safely.

Never implement table transfer as a simplistic database field update without transactional safeguards.

## 9. RESTAURANT OPERATIONS ARE THE PRIORITY

The system must behave correctly under real restaurant pressure. Ask: *what happens at 8 PM on a fully occupied Friday night?* before accepting an implementation.

## 10. FINANCIAL DATA IS SACRED

Never silently modify: payments, orders, register totals, Z reports, financial history. Corrections must be traceable.

## 11. SECURITY

Never commit: database credentials, JWT secrets, API secrets, provider secrets. Never expose secrets in frontend code.

## 12. AUTHORIZATION

Frontend hiding is not authorization. Every protected operation must be enforced server-side.

## 13. DATA ISOLATION

Future tenant isolation must be enforced in backend/domain/database access. Never trust a tenant/location identifier supplied blindly by a client. Determine authorization context securely.

## 14. IDEMPOTENCY

Critical operations must be safe to retry. Especially: payment, order creation, kitchen submission, table transfer, synchronization, register close.

## 15. OFFLINE

Offline is not "switch database." A true offline POS needs: durable outbox, synchronization, acknowledgement, reconciliation.

## 16. HARDWARE

Hardware is part of the product. A restaurant POS that cannot print its kitchen tickets is functionally broken. Therefore: printer failure, drawer failure, customer display failure must be considered first-class operational scenarios.

## 17. INTEGRATIONS

Every external integration must be: optional, configurable, isolated, retryable, observable, auditable. No external website should become a hidden dependency of core POS operations.

## 18. UI/UX ORIGINALITY

Competitor products can be researched. They cannot be cloned. Research: Odoo, Toast, Square, Lightspeed, Oracle MICROS, NCR, Clover, Google Material Design, other legitimate industry references — for feature comparison, workflow research, usability research, industry conventions.

Do not copy: proprietary source code, proprietary images, logos, trademarks, distinctive branding, proprietary assets, unlicensed components.

Create an original ASMARA POS design system.

## 19. COPYRIGHT/IP DISCLAIMER

Engineering review can reduce obvious copying and licensing risks. It cannot provide a legal guarantee. For commercially significant releases, obtain professional legal/IP review where appropriate.

## 20. CONFIGURATION OVER FORKS

Never create restaurant-specific source-code forks if configuration can solve the problem.

Bad: `if Asmara` — Good: restaurant configuration.

## 21. DATABASE

The actual production schema is the source baseline. Migration history may be inconsistent. Never assume migrations describe reality. Verify.

## 22. LEGACY CODE

Legacy code may be deleted, isolated, replaced, or retained — but only after dependency/runtime verification.

## 23. NO UNCONTROLLED SCOPE CREEP

If Claude discovers something outside the current phase: mark it `DEFERRED / DISCOVERED ITEM` — unless it is security critical, data-integrity critical, production stability critical, or an architectural blocker.

## 24. EVERY PHASE MUST READ THE BIBLE

Before starting:

```
Read Bible
↓
Read FDD
↓
Read TDD
↓
Read previous phase report
↓
Understand scope
↓
Implement
```

## 25. EVERY PHASE MUST SELF-REVIEW

At completion:

```
Build
↓
Unit tests
↓
Integration tests
↓
Regression
↓
Security check
↓
Database check
↓
Hardware check
↓
Integration check
↓
FDD comparison
↓
TDD comparison
↓
Bible comparison
↓
SaaS-readiness check
↓
UI/IP check
↓
Final phase report
```

## 26. PHASE REPORT

Every phase must produce:

- **A. Implemented** — what was changed.
- **B. Tested** — what was tested.
- **C. Preserved** — what existing functionality was verified.
- **D. Discovered** — new findings.
- **E. Deferred** — items intentionally postponed.
- **F. Risks** — remaining risks.
- **G. Bible deviations** — any architectural deviation.
- **H. FDD compliance** — PASS/FAIL by requirement.
- **I. TDD compliance** — PASS/FAIL by requirement.
- **J. Final verdict** — PASS / CONDITIONAL PASS / FAIL.

## 27. CHATGPT CTO IS FINAL TECHNICAL GATE

Claude is responsible for: implementation, testing, first-level review, documentation, self-verification.

ChatGPT is responsible for final technical/architectural approval. Claude must not treat its own PASS as final project approval.

## 28. BUSINESS OWNER

The business owner controls: commercial decisions, priorities, deployment decisions, pricing, business scope, operational rollout. Technical approval does not automatically mean production deployment.

## 29. PASS

A phase is PASS when: requirements are implemented, critical functionality preserved, tests pass, no critical defect remains, architecture is compliant, security is acceptable, database integrity is verified, rollback exists where necessary.

## 30. CONDITIONAL PASS

Used when: core functionality is acceptable, remaining issues are documented, issues are non-blocking, next steps are explicit.

## 31. FAIL

FAIL if there is: data-loss risk, payment corruption, production-breaking regression, critical security vulnerability, broken kitchen operation, broken receipt printing, unverified destructive migration, major architectural violation, missing critical requirement.

## 32. PHASE ROADMAP

```
PHASE 0   Production Safety & Baseline
PHASE 1   Complete Architecture Discovery
PHASE 2   Core Codebase Remediation
PHASE 3   Database & Domain Correction
PHASE 4   Transaction & Order Engine Hardening
PHASE 5   Authentication & Authorization Security
PHASE 6   POS Hardware Architecture
PHASE 7   Offline-First Foundation
PHASE 8   Configuration & Tenant-Ready Foundation
PHASE 9   Reporting / Audit / Financial Integrity
PHASE 10  Integration Architecture
PHASE 11  Observability / Reliability / Recovery
PHASE 12  Asmara Production Certification
PHASE 13  SaaS Foundation
PHASE 14  Multi-POS / Multi-Terminal
PHASE 15  Multi-Location
PHASE 16  Enterprise Restaurant Groups
PHASE 17  Globalization
PHASE 18  SaaS Operations / Billing / Plans
PHASE 19  Advanced Platform
```

## 33. PHASE 0

Deliver: verified backups, restore procedure, current build archive, functionality baseline, hardware baseline, product/media baseline. No architecture modification yet.

## 34. PHASE 1

Deliver: architecture map, API map, DB map, dependency map, hardware map, integration map, security map, legacy map, data-flow map. Then update: **Architecture Bible — VERIFIED BASELINE**.

## 35. PHASE 2

Clean: hardcoded configuration, duplicated code, dangerous patterns, dead code, logging, error handling, module boundaries. Do not change business behaviour unnecessarily.

## 36. PHASE 3

Fix: schema conflicts, model conflicts, migration conflicts, broken relationships, missing constraints, missing indexes.

## 37. PHASE 4

Harden: orders, tables, table transfer, kitchen, payments, register, receipts.

## 38. PHASE 5

Harden: authentication, authorization, roles, permissions, secrets, API security, audit.

## 39. PHASE 6

Abstract: printers, drawers, displays, scanners, payment hardware.

## 40. PHASE 7

Implement proper offline foundation.

## 41. PHASE 8

Introduce: configuration, tenant-ready identifiers, location configuration, terminal configuration.

## 42. PHASE 9

Harden: reporting, audit, financial integrity.

## 43. PHASE 10

Introduce: website adapter, price synchronization, future integration framework.

## 44. PHASE 11

Introduce: structured logging, metrics, health, recovery, durable jobs.

## 45. PHASE 12

Perform complete Asmara production certification.

## 46. PHASES 13–19

Only after the hardened POS foundation is proven: SaaS, multi-POS, multi-location, enterprise, globalization, commercial platform, advanced capabilities.

## 47. ARCHITECTURAL TARGET

Ultimately:

```
                    PLATFORM
                       │
                  TENANT
                       │
             ┌─────────┴─────────┐
             │                   │
           BRAND              USERS
             │
        LOCATIONS
             │
      ┌──────┴──────┐
      │             │
    FLOOR        TERMINALS
      │             │
    TABLES       REGISTERS
      │
    ORDERS
      │
 ┌────┼────┬────────┐
 │    │    │        │
Kitchen Payment Customer Reports
```

## 48. FINAL ENGINEERING PHILOSOPHY

Do not ask only: "Does this feature work?"

Ask: "Will this feature still work when 1,000 restaurants use the platform?"
Then: "Can we operate and support it?"
Then: "Can we recover it?"
Then: "Can we audit it?"
Then: "Can we configure it without custom code?"
Then: "Can we upgrade it without breaking restaurants?"

That is the standard for this product.

## 49. DEFINITION OF DONE

A feature is not DONE until:

```
Implemented
+ Tested
+ Regression tested
+ Secured
+ Audited where appropriate
+ Documented
+ Configuration considered
+ SaaS architecture considered
+ Failure behaviour considered
+ Rollback considered
+ FDD checked
+ TDD checked
+ Bible checked
+ Claude self-review
+ ChatGPT CTO approval
```

## 50. FINAL COMMAND TO IMPLEMENTATION AGENT

Claude: do not treat this document as a suggestion. Treat it as the governing engineering contract.

Before implementing anything:

1. inspect the existing system
2. protect production
3. create backups
4. verify backups
5. understand existing functionality
6. follow the current phase scope
7. preserve working behaviour
8. implement the approved improvements
9. test thoroughly
10. compare against FDD
11. compare against TDD
12. compare against this Bible
13. perform SaaS-readiness review
14. perform security review
15. perform UI/IP/license review where applicable
16. produce evidence
17. issue PASS / CONDITIONAL PASS / FAIL
18. wait for ChatGPT CTO approval before treating the phase as officially complete.

Do not guess. If something is unknown: investigate it. If something is contradictory: report it. If something is dangerous: stop and flag it. If something is outside scope: document it rather than silently changing it. If an architectural decision could cause future SaaS problems: flag it before implementation.

The goal is not to produce the fastest code. The goal is to produce a commercially trustworthy restaurant POS platform.

**END OF ENGINEERING BIBLE**
