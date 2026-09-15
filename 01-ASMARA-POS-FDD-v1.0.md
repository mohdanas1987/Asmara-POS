# ASMARA POS
## Functional Design Document (FDD) v1.0

**Product:** ASMARA Restaurant POS
**Current Production Restaurant:** Asmara Restaurant, Eindhoven
**Product Type:** Restaurant Point-of-Sale / Future SaaS Platform
**Document Status:** Master Functional Specification
**Version:** 1.0
**Authority:** Product Owner + ChatGPT CTO
**Implementation Agent:** Claude

---

## 1. PURPOSE

ASMARA POS is a real-world restaurant Point-of-Sale system currently operating in production.

The objective is to evolve the existing system into a:

- highly reliable restaurant POS
- secure POS
- configurable POS
- multi-terminal-ready POS
- multi-location-ready POS
- multi-tenant SaaS platform
- commercially viable restaurant technology product

The current working functionality is not to be discarded. The project is an evolutionary transformation:

```
Existing Production POS
        ↓
Production Hardening
        ↓
Functional Completion
        ↓
Architecture Correction
        ↓
Configuration
        ↓
Multi-POS Ready
        ↓
Multi-Location Ready
        ↓
Multi-Tenant SaaS
        ↓
Enterprise Restaurant Platform
```

## 2. FUNDAMENTAL BUSINESS RULE

The existing Asmara POS is the functional baseline. The following must be preserved unless explicitly improved:

products, categories, product images, pricing, taxes, tables, floor layout, orders, order modifications, kitchen printing, POS printing, cash drawer, customer display, payments, customers, reservations, reports, X reports, Z reports, cashier sessions, direct sales, table sales, existing important integrations, existing operational workflows.

A new architecture must not accidentally remove working functionality.

## 3. PRODUCTION PRESERVATION

Before development:

### 3.1 Database
Create: full database backup, schema backup, data backup, verified restore, backup metadata, documented restore procedure.

### 3.2 Application
Preserve: production installer, current executable/build, application configuration, source package, frontend build, backend, Electron configuration, migrations, assets, images, report files, printer configuration, update configuration.

### 3.3 Business data
Preserve: products, categories, images, customers, orders, reports, reservations, settings, taxes, tables, cashier/register data.

No destructive migration is permitted without a verified rollback.

## 4. EXISTING POS FUNCTIONALITY

### 4.1 Authentication
The system supports: login, user authentication, password validation, session/token-based access.

Future requirements: roles, permissions, tenant isolation, location permissions, terminal permissions, secure sessions, auditability.

## 5. USER TYPES

The architecture should support configurable roles. Initial conceptual roles:

**Owner / Administrator** — manages restaurant configuration, products, categories, taxes, employees, reports, integrations, terminals, printers.

**Manager** — manages operations, products, tables, orders, reports, staff-related functions according to permissions.

**Cashier** — opens register, creates orders, manages tables, processes payments, prints receipts, performs permitted register functions.

**Waiter / Server** — manages tables, creates orders, modifies orders, sends orders to kitchen, transfers tables where permitted.

**Kitchen User** — receives kitchen orders, sees preparation status, manages kitchen workflow.

The permission model must be configurable rather than hardcoded.

## 6. RESTAURANT FLOOR

The POS must support: floors, tables, table numbers/names, table positions, table status, occupied/free status, reservations, table linking, table splitting where existing functionality supports it.

Future: multiple floors, sections, configurable table shapes, capacity, table metadata, table status indicators.

## 7. NEW REQUIRED FEATURE — TABLE TRANSFER / TABLE SHIFT

This is a mandatory new core capability.

If customers are seated at Table A and must move to Table B:

```
Table A
   ↓
Active Order
   ↓
Transfer
   ↓
Table B
```

The order must remain the same logical order. Do not create a new order unnecessarily. Preserve: order ID, order number, order items, quantities, modifiers, notes, kitchen state, customer, cashier, timestamps, payment state, audit history.

Example:

```
Before

Table 5
 └── Order #1001

Table 8
 └── Empty
```

After:

```
Table 5
 └── Empty

Table 8
 └── Order #1001
```

## 8. TABLE TRANSFER RULES

**Empty destination** — transfer immediately after confirmation.

**Occupied destination** — do NOT overwrite. Provide an explicit decision: cancel, merge, other supported operation.

**Already sent to kitchen** — do not resend existing kitchen items merely because the table changed. The order identity remains unchanged. Optionally generate a configurable table-transfer notification:

```
TABLE TRANSFER

Order: #1001
From: Table 5
To: Table 8
```

**Audit** — record: order, source table, destination table, user, terminal, timestamp, reason where supported.

## 9. ORDERS

Orders must support: create, update, item addition, item removal, quantity changes, notes, modifiers, customer association, table association, kitchen submission, payment, completion, cancellation, reprinting, historical lookup.

Order states should become explicit. Example:

```
OPEN
  ↓
IN_PROGRESS
  ↓
SENT_TO_KITCHEN
  ↓
READY
  ↓
PAYMENT_PENDING
  ↓
PAID
  ↓
COMPLETED
```

Actual state model may differ after technical discovery.

## 10. ORDER INTEGRITY

The system must prevent: duplicate orders, duplicate order items, accidental overwrite, lost order data, inconsistent table state, partial transaction persistence.

All critical operations should eventually be: transactional, idempotent, auditable.

## 11. KITCHEN

Existing kitchen functionality must be preserved. Support: kitchen ticket creation, printer routing, incremental item printing, kitchen categories, reprinting, kitchen printer configuration.

Future architecture:

```
Product
   ↓
Preparation Routing
   ↓
Kitchen Station
   ↓
Printer / KDS
```

Do not permanently rely on category-name string matching.

## 12. PRODUCTS

Preserve all existing products. Product information includes as applicable: ID, name, description, price, category, image, tax, availability, status, modifiers, ordering position, metadata.

Future product architecture:

```
Product
 ├── Category
 ├── Price
 ├── Tax
 ├── Modifier Groups
 ├── Images
 ├── Availability
 └── Location-specific configuration
```

## 13. CATEGORIES

Preserve: category IDs, names, ordering, status, product relationships, images/configuration where applicable.

Future categories must be tenant/location configurable.

## 14. PRICING

Pricing must be configurable. Future support: base price, location price, channel price, scheduled price, promotional price, currency.

Most important initial external integration:

```
POS Price
     ↓
Website Integration
     ↓
Website Price
```

## 15. WEBSITE INTEGRATION

The existing connected website is NOT to be modified during this project unless explicitly approved later.

Do not: redesign it, rewrite it, migrate it, change its customer workflow, modify its database, introduce unnecessary dependencies.

The POS should expose an optional integration capability.

```
POS
 │
 └── Integration Layer
        └── Website Adapter
```

Website integration should be: optional, configurable, isolated, retryable, observable.

## 16. WEBSITE PRICE SYNCHRONIZATION

Initial priority: POS → Website price synchronization.

The architecture should eventually allow: enable/disable integration, select products/categories, sync manually, sync automatically, retry failed sync, show sync status, audit changes.

## 17. PAYMENTS

Existing payment functionality must be preserved. Future architecture should support:

```
Order
   ↓
Payment Intent
   ↓
Payment Transaction
   ↓
Payment Method
   ↓
Provider
```

Future support: cash, card, external terminal, online payment, refunds, voids, reconciliation.

Payment providers must use adapters.

## 18. CASH REGISTER

Support:

```
OPEN
 ↓
ACTIVE
 ↓
X REPORT
 ↓
Z REPORT
 ↓
CLOSED
```

Support: opening cash, sales, payment tracking, closing cash, register reports, cashier association, audit.

Financial operations must be reliable and traceable.

## 19. CUSTOMERS

Preserve customer functionality. Future customer model:

```
Customer
 ├── Contact Information
 ├── Orders
 ├── Reservations
 ├── Loyalty
 └── Consent/Preferences
```

Customer data must be tenant isolated in SaaS.

## 20. RESERVATIONS

Existing reservation functionality must be preserved. The current broken/legacy model must be corrected during database/domain remediation.

Future: date, time, guest count, customer, table, status, notes, source, integration reference.

## 21. REPORTS

Support: X report, Z report, sales reports, payment reports, cashier reports, tax reports, register reports, operational reports.

Reports must be derived from authoritative transactional data.

## 22. RECEIPTS

Preserve: receipt printing, receipt generation, reprinting, applicable restaurant information, taxes, payment information.

Future: configurable templates, country-specific formats, multilingual receipts, multiple printers.

## 23. CUSTOMER DISPLAY

Preserve current customer display functionality. Future: terminal-specific display, configurable content, order display, promotional content, payment information.

## 24. HARDWARE

Preserve current hardware support. The architecture must eventually abstract: receipt printers, kitchen printers, cash drawers, customer displays, scanners, payment terminals.

## 25. OFFLINE OPERATION

The current SQLite switching mechanism is not automatically considered a complete offline architecture. Future:

```
Cloud
  ↕
Sync Engine
  ↕
Local POS Database
```

Transactions need: UUID, tenant, location, terminal, timestamp, local sequence, operation, idempotency key, sync status.

## 26. MULTI-POS

Future target:

```
Restaurant
 ├── POS 1
 ├── POS 2
 ├── POS 3
 └── POS N
```

The system must support concurrent terminals without corrupting: orders, tables, payments, registers, kitchen state.

## 27. MULTI-LOCATION

Future:

```
Tenant
 ├── Location A
 ├── Location B
 └── Location N
```

Location-specific: menu, prices, taxes, tables, terminals, printers, staff, configuration.

## 28. MULTI-TENANT SAAS

Future:

```
Platform
 └── Tenant
      ├── Brand
      ├── Locations
      ├── Employees
      ├── Menus
      ├── Terminals
      └── Integrations
```

Tenant isolation is mandatory.

## 29. CONFIGURATION OVER CUSTOM CODE

Restaurant-specific behaviour must become configuration. Avoid:

```
if restaurant == "Asmara"
```

Prefer:

```
tenant configuration
location configuration
terminal configuration
integration configuration
```

## 30. UI/UX

The interface must be: fast, touch friendly, clear, operationally efficient, accessible, responsive to supported POS resolutions, suitable for busy restaurant environments.

The UI must not intentionally copy another provider.

## 31. UI/IP/COPYRIGHT REQUIREMENT

Competitors may be researched for: feature coverage, workflow, usability, industry conventions, operational patterns.

Examples: Odoo, Toast, Square, Lightspeed, Oracle MICROS, NCR, Clover, Google Material Design.

But do not copy: proprietary code, logos, trademarks, copyrighted assets, distinctive branded visual identity, proprietary screenshots, proprietary illustrations, unlicensed components.

Every UI phase must include an **UI/UX Originality & Third-Party License Review**. This is an engineering safeguard, not a legal guarantee.

## 32. ACCESSIBILITY

Future UI should consider: keyboard operation, touch operation, readable text, sufficient contrast, focus states, semantic controls, error visibility, appropriate sizing.

## 33. NOTIFICATION SYSTEM

Existing notifications must be preserved. Future: system notifications, operational alerts, stock alerts, printer failures, integration failures, synchronization failures, security alerts.

## 34. PRODUCT IMAGE MANAGEMENT

Preserve existing images. Future: object storage, CDN, image transformations, optimized formats, tenant/location ownership, image lifecycle management.

## 35. AUDIT

Important actions must eventually be auditable. Examples: login, product price change, product deletion, order cancellation, table transfer, payment, refund, register opening, register closing, configuration change, user/permission change.

## 36. NON-FUNCTIONAL REQUIREMENTS

The POS must prioritize:

- **Reliability** — restaurant operation must continue safely.
- **Performance** — POS interactions should feel immediate.
- **Security** — no hardcoded production secrets.
- **Integrity** — transactions must not be silently lost or duplicated.
- **Recoverability** — failures must have rollback/recovery paths.
- **Maintainability** — code should be modular and understandable.
- **Scalability** — architecture must support future SaaS scale.
- **Observability** — failures must be diagnosable.

## 37. FUNCTIONAL REGRESSION RULE

Every release must test:

```
Login
→ Register
→ Table
→ Order
→ Modify
→ Kitchen
→ Table Transfer
→ Payment
→ Receipt
→ Reports
→ X
→ Z
→ Close
```

Also: printer failure, application restart, network loss, duplicate actions, database restart, customer display, product images, categories, existing integrations.

## 38. FDD ACCEPTANCE RULE

A phase cannot be considered functionally complete solely because code compiles. It requires: implementation, build, tests, regression, functionality preservation, FDD comparison, TDD comparison, Bible comparison, documented deviations, final CTO review.

## 39. FUTURE COMMERCIAL PRODUCT

The final product should be capable of serving:

```
1 restaurant
1 POS
```

then:

```
1 restaurant
10+ POS
```

then:

```
100s of restaurants
```

then:

```
enterprise/global restaurant groups
```

without architectural rewrites.

**END OF FDD**
