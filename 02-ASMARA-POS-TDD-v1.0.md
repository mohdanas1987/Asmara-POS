# ASMARA POS
## Technical Design Document (TDD) v1.0

**Version:** 1.0
**Status:** Master Technical Specification
**Implementation:** Claude
**Architecture Authority:** ChatGPT CTO

---

## 1. CURRENT SYSTEM BASELINE

The current application is an Electron desktop POS. Conceptually:

```
Windows
   ↓
Electron
   ├── React UI
   ├── Electron Main
   ├── Preload
   ├── Customer Display
   ├── Printing
   ├── Cash Drawer
   └── Embedded Backend
           ↓
       Express
           ↓
      Objection.js
           ↓
        Knex
           ↓
         MySQL
```

There are also legacy/partial: SQLite, Redis, GraphQL, Pusher, Nisarga, external synchronization, local storage, local report generation.

These must be classified before removal.

## 2. TECHNICAL PRINCIPLE

Do not perform a blind rewrite. Preferred evolution:

```
Current Monolith
      ↓
Clean Modular Monolith
      ↓
Well-defined Domain Boundaries
      ↓
Configurable POS
      ↓
Multi-terminal architecture
      ↓
Multi-location
      ↓
Multi-tenant SaaS
```

Microservices are not required merely because SaaS is the goal.

## 3. TARGET ARCHITECTURE

Conceptual:

```
Electron POS
      │
      ▼
POS Application Layer
      │
      ├── Authentication
      ├── Orders
      ├── Tables
      ├── Kitchen
      ├── Payments
      ├── Register
      ├── Products
      ├── Customers
      ├── Reservations
      ├── Reports
      └── Configuration
             │
             ▼
       Domain Services
             │
             ▼
        Persistence
             │
        ┌────┴────┐
      MySQL    Local DB
```

Future:

```
Cloud Platform
      │
      ├── Tenant
      ├── Location
      ├── Identity
      ├── Configuration
      ├── Orders
      ├── Reporting
      ├── Integrations
      └── Device Management
              ↕
          Sync Engine
              ↕
          POS Terminal
```

## 4. DOMAIN MODULES

Create clear boundaries around:

```
Identity
Users
Roles
Permissions

Tenant
Brand
Location
Terminal

Floor
Table

Menu
Category
Product
Modifier
Price
Tax

Order
OrderItem
Kitchen

Payment
PaymentTransaction

Register
CashSession

Customer
Reservation

Reports
Audit

Integration
Website
Payment Providers
Future external systems
```

## 5. DATABASE PRINCIPLE

The actual production database must be treated as the source baseline. Before schema changes:

```
Production DB
      ↓
Schema capture
      ↓
Data validation
      ↓
Backup
      ↓
Target schema design
      ↓
Migration
      ↓
Validation
```

No destructive migration without rollback.

## 6. MIGRATION STRATEGY

Current migration history contains inconsistencies and conflicting generations. Therefore:

1. inventory all migrations
2. determine actual production schema
3. determine intended schema
4. identify obsolete migrations
5. create authoritative migration strategy
6. test on a database copy
7. verify row counts
8. verify relationships
9. verify application behaviour
10. only then apply to production

Never rewrite history casually.

## 7. IDENTIFIERS

Future distributed/offline architecture should use globally unique IDs. Recommended: UUID/ULID or equivalent, stable external IDs where necessary.

Do not depend on local auto-increment IDs as global transaction identity.

## 8. TENANCY

Future core records should conceptually support: `tenant_id`, `location_id`, `terminal_id` where applicable.

Tenant isolation must exist at: database query level, service level, authorization level, API level.

Never rely solely on frontend filtering.

## 9. AUTHORIZATION

Implement:

```
Authentication
      ↓
User
      ↓
Role
      ↓
Permission
      ↓
Tenant
      ↓
Location
      ↓
Resource
```

Future record-level authorization must be possible.

## 10. SECRETS

Never store production secrets in source code. Secrets must come from: environment configuration, secure secret storage, deployment configuration.

Never expose: DB passwords, JWT secrets, API secrets, provider credentials — in source or frontend bundles.

## 11. API DESIGN

Prefer REST initially. Rules: correct HTTP methods, authentication, authorization, validation, consistent error responses, structured logging, idempotency for critical writes.

Do not use GET for destructive mutations.

## 12. ORDER API

Conceptually:

```
POST   /orders
GET    /orders/:id
PATCH  /orders/:id
POST   /orders/:id/items
PATCH  /orders/:id/items/:itemId
POST   /orders/:id/send-to-kitchen
POST   /orders/:id/complete
POST   /orders/:id/cancel
POST   /orders/:id/transfer-table
```

Actual endpoint names may differ after discovery.

## 13. TABLE TRANSFER TECHNICAL DESIGN

Table transfer must be an explicit domain operation. Conceptually:

```
transferTable(
    orderId,
    sourceTableId,
    destinationTableId,
    userId,
    terminalId
)
```

Atomic transaction:

```
BEGIN

Validate order
Validate source table
Validate destination table
Validate permissions
Validate destination state

Update order table association
Update source table state
Update destination table state

Create audit event

COMMIT
```

If anything fails:

```
ROLLBACK
```

No partial transfer.

## 14. TABLE TRANSFER CONCURRENCY

Prevent two terminals from transferring the same order simultaneously. Use appropriate: row locks, optimistic concurrency, versioning, transactional checks — depending on the database design.

## 15. KITCHEN ARCHITECTURE

Do not couple kitchen routing directly to string comparisons. Target:

```
Product
   ↓
Preparation Rule
   ↓
Kitchen Station
   ↓
Printer / KDS
```

Support multiple stations eventually.

## 16. PAYMENT ARCHITECTURE

Use adapters:

```
Payment Service
      │
      ├── Cash Adapter
      ├── Card Adapter
      ├── Provider A
      ├── Provider B
      └── Online Payment
```

The core order engine should not depend on one payment provider.

## 17. HARDWARE ABSTRACTION

```
Hardware Service
      │
      ├── Printer
      ├── Kitchen Printer
      ├── Cash Drawer
      ├── Customer Display
      └── Payment Terminal
```

Electron-specific code should be isolated behind interfaces where practical.

## 18. ELECTRON SECURITY

Maintain: context isolation, node integration disabled in renderer, controlled IPC, preload boundary, minimal IPC exposure, validated IPC inputs.

Avoid generic unrestricted IPC channels.

## 19. LOCAL DATABASE

The local POS database must eventually support: order transactions, offline operation, sync queue, terminal identity, local sequence, idempotency.

SQLite switching based merely on Internet availability is insufficient.

## 20. SYNC ARCHITECTURE

Target:

```
Local Transaction
      ↓
Outbox
      ↓
Sync Engine
      ↓
Cloud API
      ↓
Acknowledgement
      ↓
Marked Synced
```

Each transaction should be replay-safe.

## 21. IDEMPOTENCY

Critical commands must support idempotency. Examples: create order, payment, refund, send kitchen ticket, table transfer, register close, synchronization.

A retry must not create duplicate business effects.

## 22. EVENTS

Future event model:

```
OrderCreated
OrderItemAdded
OrderItemRemoved
OrderSentToKitchen
OrderCompleted
PaymentCaptured
PaymentRefunded
TableTransferred
RegisterOpened
RegisterClosed
ReservationCreated
ProductUpdated
PriceChanged
```

Events should be designed for future integration and audit.

## 23. WEBSITE INTEGRATION

Use an adapter:

```
WebsiteIntegration
      │
      ├── Authentication
      ├── Product Sync
      ├── Price Sync
      └── Future Orders
```

The website must remain external. No core POS business logic should directly depend on the website implementation.

## 24. PRICE SYNCHRONIZATION

Target flow:

```
Price Change
     ↓
Domain Event
     ↓
Integration Queue
     ↓
Website Adapter
     ↓
Website API
     ↓
Acknowledgement
```

Support: retry, failure tracking, idempotency, audit, manual retry, sync status.

## 25. CONFIGURATION

Configuration hierarchy:

```
Platform
 ↓
Tenant
 ↓
Brand
 ↓
Location
 ↓
Terminal
```

More specific configuration overrides broader defaults.

## 26. CONFIGURATION EXAMPLES

Restaurant configuration: currency, tax, receipt, opening hours, order types, kitchen routing, printer, payment, website integration.

Terminal configuration: assigned location, register, receipt printer, kitchen printers, customer display, capabilities.

## 27. OBSERVABILITY

Implement structured logging. Logs should include where appropriate: timestamp, tenant, location, terminal, user, request ID, transaction ID, event, result, error.

Never log secrets.

## 28. ERROR HANDLING

Errors should be: structured, classified, actionable, safe for users, detailed in logs, traceable.

Do not expose stack traces or secrets to end users.

## 29. DATABASE INTEGRITY

Use: foreign keys where appropriate, unique constraints, indexes, check constraints where supported, transactions, appropriate data types.

Business rules must not depend exclusively on application code.

## 30. PERFORMANCE

Initial priority: fast POS interaction, efficient queries, indexes, controlled connection pools, avoid unnecessary API calls, efficient images, bounded background jobs.

Future: caching, read models, queues, horizontal scaling — only when justified.

## 31. BACKGROUND JOBS

Current local cron scheduler must eventually evolve into a durable job mechanism. Target:

```
Application
   ↓
Queue
   ↓
Worker
   ↓
Job
   ↓
Result
```

Jobs must support: retry, failure state, idempotency, monitoring.

## 32. FILE STORAGE

Current local storage must eventually be abstracted. Target:

```
Media Service
    │
    ├── Local Development
    ├── Object Storage
    └── CDN
```

Do not couple business logic to local filesystem paths.

## 33. REPORTING

Reports should derive from authoritative transaction data. Avoid making generated PDF files the financial source of truth.

## 34. TESTING STRATEGY

Required layers: unit tests (domain logic), integration tests (database/API), hardware abstraction tests (printer/drawer/display adapters), end-to-end tests (critical restaurant workflows), regression tests (existing functionality), migration tests (database upgrades and rollback), security tests (authentication/authorization/input handling), failure tests (network/database/printer failure).

## 35. CRITICAL E2E TEST

The following must always work:

```
Login
↓
Open Register
↓
Select Table
↓
Create Order
↓
Add Items
↓
Send Kitchen
↓
Transfer Table
↓
Modify Order
↓
Payment
↓
Receipt
↓
Complete
↓
X Report
↓
Z Report
↓
Close Register
```

## 36. UI ARCHITECTURE

The UI should be treated as a domain client, not the source of business truth. Business validation belongs server/domain side.

Frontend should handle: presentation, interaction, local state, optimistic UX where safe, API communication.

## 37. UI DESIGN SYSTEM

Create an ASMARA POS design system. Define: typography, spacing, buttons, forms, tables, dialogs, notifications, floor plan, order panel, payment UI, kitchen UI, reports, accessibility.

Avoid random component styling.

## 38. UI/IP REVIEW

For every major UI change: identify inspiration, identify third-party components, check licenses, check assets, ensure no proprietary code was copied, ensure branding is original, ensure distinctive competitor visual identity is not reproduced, document findings.

This is an engineering compliance process, not a legal opinion.

## 39. DEPENDENCY MANAGEMENT

Every dependency should be: known, justified, licensed appropriately, maintained where practical, vulnerability monitored.

Generate a dependency/license inventory.

## 40. DEPLOYMENT

Future production deployment must support: versioned builds, rollback, controlled rollout, migration compatibility, health checks, logs, update monitoring.

Electron auto-update should eventually support controlled release channels.

## 41. BACKWARD COMPATIBILITY

Where possible:

```
Old Data
   ↓
Migration
   ↓
New Data Model
```

Do not destroy historical business information.

## 42. DATA MIGRATION

Every migration must document: source, target, transformation, affected tables, row counts, validation, rollback, backup requirement.

## 43. SECURITY BASELINE

Mandatory: no hardcoded secrets, secure password hashing, secure token secret, authorization, input validation, parameterized queries/ORM, CORS restriction, secure headers, rate limiting where appropriate, audit, least privilege.

## 44. TARGET SCALE

Architecture should eventually accommodate:

```
1 Tenant
1 Location
1 POS
```

through:

```
1 Tenant
100+ Locations
many POS terminals/location
```

and eventually many tenants. Do not prematurely claim a capacity that has not been load-tested.

## 45. ARCHITECTURAL CONSTRAINT

Do not introduce microservices simply for appearance. A clean modular monolith is acceptable until actual scale requires decomposition.

## 46. TDD ACCEPTANCE

Technical completion requires: implementation, tests, security review, database validation, architecture compliance, performance sanity checks, migration verification, rollback capability, documentation.

**END OF TDD**
