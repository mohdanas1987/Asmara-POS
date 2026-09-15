# Asmara POS Architecture Bible v1.0

**Project:** Asmara POS\
**Current production customer:** Asmara Restaurant, Eindhoven,
Netherlands\
**Current application version observed:** 5.0.4\
**Architecture state:** Production legacy / single-customer restaurant
POS\
**Phase:** 1 --- Understand Everything\
**Document purpose:** Establish a factual baseline of the current system
before remediation, refactoring, or SaaS transformation.

------------------------------------------------------------------------

## 1. Executive Summary

Asmara POS is a Windows desktop restaurant point-of-sale application
distributed as an Electron executable.

The current production architecture is centered around:

``` text
Windows
  |
  v
Electron Desktop Application
  |
  +-- React production UI
  +-- Electron main process
  +-- Customer display window
  +-- Local printing / cash drawer
  +-- Embedded Express server
  +-- Scheduled jobs
  |
  v
Node.js / Express
  |
  +-- Authentication
  +-- POS
  +-- Tables
  +-- Menu
  +-- Items
  +-- Orders
  +-- Payments
  +-- Taxes
  +-- Configuration
  +-- Reports
  |
  v
Objection.js / Knex
  |
  v
MySQL database
```

The application also contains partial/legacy infrastructure for:

-   SQLite/offline operation
-   Redis caching
-   GraphQL
-   an older "Nisarga" application generation
-   external product/database synchronization
-   remote website/image storage

These components must be classified as **active, partially active,
legacy, or dead code** before they are retained in the future
architecture.

The application is not currently a true SaaS platform. It is
fundamentally a single-restaurant/single-installation architecture with
a remote MySQL dependency and restaurant-specific configuration embedded
in the client.

------------------------------------------------------------------------

# 2. Source Package Inventory

The supplied package is a packaged Windows Electron application.

Important application-owned components include:

``` text
main.js
main-nisarga.js
preload.js
renderer.js
watchInternet.js

backend/
  server.js
  nisarga-server.js
  db.js
  knexfile.js
  redis.js

  routes/
    auth.js
    config.js
    items.js
    menu.js
    orders.js
    pos.js
    tables.js
    tax.js

  models/
    Application.js
    CashRegister.js
    Currency.js
    Customer.js
    Item.js
    MenuCategory.js
    Notification.js
    Order.js
    OrderDetail.js
    Queue.js
    Report.js
    Reservation.js
    Setting.js
    Table.js
    Tax.js
    User.js

  migrations/
    multiple historical schema generations

  utils/
    constants.js
    storage.js
    jobs/scheduler.js
    utils.js

  client/build/
    compiled React frontend
```

The package also contains a large dependency tree and Electron/Chromium
runtime files.

------------------------------------------------------------------------

# 3. Desktop Runtime

## 3.1 Electron

Observed Electron runtime:

``` text
Electron 34.3.0
Chromium 132.x
```

The production executable launches the Electron main process.

The Electron main process:

-   loads environment configuration
-   starts the embedded backend
-   starts the scheduler
-   creates the main POS window
-   detects secondary displays
-   creates a customer-facing display when available
-   handles printing
-   handles cash drawer opening
-   handles application relaunch/reload
-   handles automatic updates

------------------------------------------------------------------------

# 4. Main POS Window

The main window is created using Electron `BrowserWindow`.

Important security settings currently present:

``` text
contextIsolation = true
nodeIntegration = false
```

This is a good baseline for the main renderer.

The application loads:

``` text
http://localhost:5101
```

The embedded Express server therefore serves the POS frontend locally.

The POS is forced into fullscreen after loading.

The application disables normal window opening through Electron's
window-open handler.

------------------------------------------------------------------------

# 5. Customer Display

The application detects available monitors.

If a second display exists, it creates a second Electron window and
loads:

``` text
http://localhost:5101/#/customer-screen
```

The architecture is therefore:

``` text
                 POS Terminal
                      |
              Electron Main Process
                 /           \
                /             \
        POS Window       Customer Window
                             |
                       Customer Display
```

The main process can push data to secondary windows using IPC.

This is an important existing capability and should be retained in the
SaaS product.

------------------------------------------------------------------------

# 6. Electron IPC

`preload.js` exposes a controlled `electronAPI` through `contextBridge`.

Capabilities include:

-   receiving display data
-   sending IPC messages
-   barcode generation trigger
-   printing content
-   printing reports
-   opening cash drawer
-   updating customer display
-   reloading windows
-   discovering printers
-   closing/relaunching application
-   sending kitchen tickets
-   fullscreen control
-   update notifications
-   application restart after update

The preload layer is therefore the bridge between:

``` text
React renderer
      |
      v
contextBridge
      |
      v
Electron main process
```

The future architecture should preserve this separation but replace
broad generic IPC channels with narrowly scoped, validated commands.

------------------------------------------------------------------------

# 7. Embedded Backend

The Electron application starts an Express backend in the same
process/application environment.

Current backend port:

``` text
5101
```

The backend serves both:

1.  REST APIs
2.  compiled React static assets

The server mounts:

``` text
/auth
/tables
/menu
/items
/orders
/pos
/tax
/config
```

It also serves:

``` text
/images
```

from local application storage.

------------------------------------------------------------------------

# 8. Backend Stack

Current backend stack:

``` text
Node.js
Express 4
Objection.js
Knex
MySQL2
bcrypt
jsonwebtoken
multer
sharp
xlsx
html-pdf
axios
SQLite3
Redis client
```

The application therefore uses an ORM/query-builder combination:

``` text
Application
   |
Objection.js
   |
Knex
   |
mysql2
   |
MySQL
```

------------------------------------------------------------------------

# 9. Database Architecture

The active database configuration is MySQL.

The application contains environment configuration for:

-   remote database host
-   database name
-   database user
-   database password

Sensitive values are intentionally not reproduced in this document.

The current database is remote rather than being a local database owned
by the POS terminal.

This creates a fundamental dependency:

``` text
POS terminal
      |
      | network
      v
Remote MySQL
```

If the remote database is unavailable, transactional POS operations can
be affected.

------------------------------------------------------------------------

# 10. Connection Pool

The current primary database configuration uses a MySQL connection pool
with a maximum around 30 connections.

This is oversized/ambiguous for a single desktop terminal and needs to
be reassessed during remediation.

The future SaaS system should move database connection management to the
backend service rather than exposing direct database credentials to
desktop clients.

------------------------------------------------------------------------

# 11. SQLite / Offline Architecture

The code contains:

``` text
sqlite3
offline.sqlite
switchToSQLite()
switchToMySQL()
watchInternet.js
```

The intended design is:

``` text
Internet available
      |
      v
MySQL

Internet unavailable
      |
      v
SQLite
```

`watchInternet.js` checks DNS connectivity to Google every 10 seconds
and switches the Objection/Knex database connection.

However, this must NOT currently be classified as a reliable
offline-first architecture.

Reasons:

-   the local SQLite artifact is not evidence of a complete operational
    offline database
-   the migrations primarily describe MySQL-oriented production schema
    evolution
-   switching databases is not equivalent to synchronizing transactional
    state
-   no robust conflict-resolution model exists
-   no durable outbound/inbound synchronization engine is evident
-   changing ORM connection at runtime does not migrate remote state
    into SQLite
-   no demonstrated idempotent synchronization protocol exists

Therefore:

**Offline capability: PARTIAL / NOT PROVEN.**

------------------------------------------------------------------------

# 12. Authentication

Current authentication flow:

``` text
Email + Password
       |
       v
bcrypt password verification
       |
       v
JWT
       |
       v
fetchuser middleware
       |
       v
Protected route
```

The users table contains:

-   id
-   name
-   email
-   password
-   type
-   verified
-   status
-   email verification timestamp
-   remember token
-   timestamps

The application has cashier-oriented user types.

------------------------------------------------------------------------

# 13. Authorization

Authentication and authorization are currently mixed.

The `fetchuser` middleware primarily establishes the authenticated user
identity.

The application does not yet demonstrate a mature permission model such
as:

``` text
Role
Permission
Resource
Action
Location
Terminal
```

Several endpoints are protected only by authentication, while other
state-changing endpoints do not consistently require authentication.

Therefore:

**Authorization maturity: LOW / NEEDS REDESIGN.**

The future platform requires proper RBAC plus location/tenant
boundaries.

------------------------------------------------------------------------

# 14. Restaurant Domain

The current domain is restaurant-oriented rather than generic retail.

Core entities include:

``` text
Restaurant operational concepts
  |
  +-- Users / Cashiers
  +-- Customers
  +-- Tables
  +-- Reservations
  +-- Menu Categories
  +-- Menu Items
  +-- Orders
  +-- Payments
  +-- Taxes
  +-- Cash Registers
  +-- Reports
  +-- Notifications
  +-- Settings
```

------------------------------------------------------------------------

# 15. Menu Architecture

Current menu structure:

``` text
MenuCategory
    |
    +-- MenuItem
```

The active models use:

``` text
menu_categories
menu_items
```

A menu item includes concepts such as:

-   name
-   image
-   category
-   price
-   quantity
-   unit
-   POS visibility
-   sales description
-   tax
-   code/barcode
-   deleted flag

The category includes:

-   name
-   color
-   status

------------------------------------------------------------------------

# 16. Product / Menu Naming Legacy

The migrations contain older concepts:

``` text
products
product_categories
products_categories
```

while active models use:

``` text
menu_items
menu_categories
```

This is evidence of historical schema evolution.

The migration history also contains files whose names and actual table
modifications do not consistently match.

This is a major technical-debt area.

Before SaaS conversion, the actual production database schema must be
inventoried independently from the migration folder.

------------------------------------------------------------------------

# 17. Table / Floor Management

Tables are represented as entities containing operational state.

The frontend has floor/table visualization.

The application supports:

-   table positioning
-   table splitting
-   freeing tables
-   occupied/free status
-   linking tables
-   reservations

The architecture is effectively:

``` text
Restaurant
   |
Floor
   |
Table
   |
Order
```

However, the current database does not model this hierarchy cleanly.

A SaaS architecture should introduce:

``` text
Tenant
  |
Location
  |
Floor
  |
Table
```

------------------------------------------------------------------------

# 18. Order Lifecycle

The current order lifecycle is approximately:

``` text
Select table
      |
      v
Initialize order
      |
      v
Add items
      |
      v
Update order
      |
      v
Send to kitchen
      |
      v
Payment
      |
      v
Complete order
```

Orders can also be created as direct sales.

Orders contain serialized JSON data rather than fully normalized
order-line structures.

The current order model includes:

-   id
-   table relationship/concept
-   customer
-   amount
-   data
-   payment mode
-   user/cashier
-   cash register
-   timestamps
-   status

------------------------------------------------------------------------

# 19. Order Data Model

A major architectural characteristic is the use of JSON blobs.

Order information such as quantities, notes, taste/spice choices, and
kitchen state can be stored inside JSON fields.

This makes rapid development easy but creates problems for:

-   reporting
-   analytics
-   inventory
-   auditing
-   financial reconciliation
-   partial refunds
-   product history
-   price history
-   tax history
-   SaaS analytics
-   synchronization

The future platform should normalize transactional order data.

Target model:

``` text
Order
  |
  +-- OrderItem
  |     +-- Product snapshot
  |     +-- Quantity
  |     +-- Unit price
  |     +-- Tax
  |     +-- Discount
  |     +-- Modifiers
  |
  +-- Payments
  +-- Discounts
  +-- Taxes
  +-- Customer
  +-- Table
  +-- Cashier
  +-- Register
```

------------------------------------------------------------------------

# 20. Kitchen Workflow

The POS has a kitchen-printing workflow.

When an order is sent to the kitchen:

``` text
Order
  |
  v
Determine kitchen items
  |
  v
Prepare kitchen ticket
  |
  v
Electron print IPC
  |
  v
Configured printer
```

The application has special logic for non-kitchen categories such as
beverages and drinks.

The current implementation uses category-name matching.

This is fragile.

Future design:

``` text
Product
   |
Preparation Routing
   |
Kitchen Station
```

Examples:

``` text
Pizza -> Pizza Station
Burger -> Grill
Coffee -> Bar
Cocktail -> Bar
Dessert -> Dessert
```

Routing must be configurable per restaurant/location.

------------------------------------------------------------------------

# 21. Payments

Current payment handling is relatively simple.

The order has a payment mode/status and payment information can be
stored in order data.

Payment update marks the order as:

``` text
paid
```

The current model does not provide a mature payment transaction ledger.

The future architecture must separate:

``` text
Order
Payment Intent
Payment Transaction
Payment Method
Provider
Refund
Void
Settlement
```

This is essential for a global SaaS platform.

------------------------------------------------------------------------

# 22. Cash Register

The application has a `cash_register` concept.

A register contains:

-   opening cash
-   closing cash
-   date
-   active/inactive status
-   user

Orders can reference a cash register.

The intended lifecycle is:

``` text
Open Register
     |
     v
Sell
     |
     v
Accept Payments
     |
     v
X Report
     |
     v
Z Report
     |
     v
Close Register
```

------------------------------------------------------------------------

# 23. X Report

The X report represents a non-closing operational report.

It aggregates information including:

-   transactions
-   product quantities
-   total sales
-   cash
-   card
-   account
-   taxes
-   categories
-   discounts

The report is rendered into printable HTML.

------------------------------------------------------------------------

# 24. Z Report

The Z report is the closing report.

It can:

-   generate closing totals
-   create report output
-   close the cash register
-   reset table status

This is a critical financial workflow.

Future SaaS architecture must make Z-report generation:

-   transactional
-   idempotent
-   auditable
-   immutable after closure
-   location-aware
-   register-aware
-   timezone-aware

------------------------------------------------------------------------

# 25. Reports

Reports are persisted in the `reports` table and PDF files are stored
under local temporary/report storage.

This means report persistence is split between:

``` text
Database metadata
+
Local filesystem PDF
```

That is not a robust SaaS reporting architecture.

Future design should use:

``` text
Transactional data
      |
      v
Reporting/analytics service
      |
      +-- operational reports
      +-- financial reports
      +-- exports
      +-- audit reports
```

------------------------------------------------------------------------

# 26. Customers

Customer records contain:

-   name
-   phone
-   email
-   title
-   street
-   state
-   city
-   notes

Phone is currently unique.

For SaaS, customers should be modeled with tenant/location/global
identity rules.

A future customer architecture may support:

``` text
Tenant Customer
   |
   +-- Orders
   +-- Reservations
   +-- Loyalty
   +-- Marketing consent
   +-- Preferences
```

------------------------------------------------------------------------

# 27. Reservations

The code contains a Reservation model and reservation route.

However, the current `Reservation` model is structurally incorrect:

-   the class is named `Report`
-   it maps to the `reports` table
-   its relation mapping is incomplete/invalid

Therefore:

**Reservation implementation in the supplied backend is NOT reliable
evidence of a correct reservation domain model.**

The live website does expose an online reservation workflow with date,
time, guest count, name, email and phone fields. citeturn0search1

The website therefore represents a real external reservation surface
that must be traced to its actual backend/integration.

------------------------------------------------------------------------

# 28. Website Integration

The live Asmara website is:

https://asmara-eindhoven.nl/

The site exposes:

-   restaurant information
-   menu
-   menu categories
-   restaurant contact information
-   reservation workflow
-   opening hours

The website currently presents menu content and online reservation
functionality. citeturn0search0turn0search2turn0search1

The POS package contains direct references to:

``` text
https://asmara-eindhoven.nl
https://asmara-eindhoven.nl/api
https://asmara-eindhoven.nl/storage
```

Therefore the relationship is not hypothetical.

The current package strongly indicates that the POS and restaurant
website participate in a shared application/data ecosystem.

The exact production data flow still requires runtime/server-side
tracing.

------------------------------------------------------------------------

# 29. Website → POS Integration Status

Confirmed:

``` text
POS frontend
      |
      v
asmara-eindhoven.nl/api
```

Confirmed:

``` text
POS frontend
      |
      v
asmara-eindhoven.nl/storage
```

Confirmed:

``` text
POS backend
      |
      v
asmara-eindhoven.nl/upload/image
```

There are also external product synchronization calls to another
service.

Not yet fully confirmed:

``` text
Website reservation
        |
        ?
        v
POS reservation table
```

This must be traced before making architectural assumptions.

------------------------------------------------------------------------

# 30. External Product Synchronization

The backend contains product synchronization calls to an external POS
service.

There are operations conceptually equivalent to:

``` text
Create/update product
       |
       v
External product service
```

and:

``` text
Remove product
       |
       v
External product service
```

This means the current POS is already participating in an integration
architecture.

That integration must be isolated behind a formal adapter in the SaaS
redesign.

------------------------------------------------------------------------

# 31. Image Storage

Product images are processed locally using `sharp`.

The application can:

-   download images
-   resize images
-   convert to WebP
-   save them locally
-   synchronize images externally

The current system mixes:

``` text
Local filesystem
+
Website storage
+
External APIs
```

The SaaS architecture should centralize media through object
storage/CDN.

------------------------------------------------------------------------

# 32. Settings

Settings are stored as key/value records:

``` text
settings
  |
  +-- user_id
  +-- key
  +-- value
```

Examples include:

-   inventory state
-   stock alert
-   last updated date

This is user-scoped configuration.

The SaaS platform needs a hierarchy such as:

``` text
Platform Setting
Tenant Setting
Location Setting
Terminal Setting
User Preference
```

------------------------------------------------------------------------

# 33. Inventory

There is a basic stock quantity and an inventory enable/disable setting.

This is not yet a full inventory system.

Missing concepts include:

-   stock ledger
-   warehouses
-   ingredients
-   recipes
-   stock movements
-   purchase orders
-   suppliers
-   wastage
-   stock adjustments
-   unit conversions
-   batch/lot tracking
-   cost tracking

Inventory should therefore be considered a future domain, not merely an
extension of the current `quantity` field.

------------------------------------------------------------------------

# 34. Taxes

Taxes have:

-   name
-   amount
-   status

The current implementation uses strings for tax amounts in several
places.

Future tax architecture must support:

``` text
Country
Region
Tax Authority
Tax Rule
Tax Rate
Effective Date
Product Tax Category
Order Tax
Tax Exemption
```

This becomes important for global SaaS deployment.

------------------------------------------------------------------------

# 35. Currency

A currency model exists.

The current implementation is basic:

-   name
-   status
-   unit

The future system must support:

-   ISO currency codes
-   currency precision
-   rounding rules
-   location currency
-   payment currency
-   reporting currency
-   exchange rates where required

------------------------------------------------------------------------

# 36. Scheduler

A Node cron scheduler is included.

It runs frequently and checks configured jobs.

Its main observed purpose is automated report generation.

Conceptually:

``` text
Scheduler
   |
   v
Queue configuration
   |
   v
Generate Z report
```

This is a local desktop scheduler, not a durable distributed job system.

For SaaS:

``` text
API
 |
Queue
 |
Worker
 |
Job
 |
Audit/result
```

should replace local process-only scheduling.

------------------------------------------------------------------------

# 37. Redis

Redis support exists.

The Redis module creates a client and defines connection handling.

GraphQL resolvers use Redis caching for concepts such as:

-   tables
-   menu

However, the main Express server does not mount the GraphQL
schema/resolvers.

Therefore:

**Redis: PRESENT, but active production role requires verification.**

**GraphQL: CODE PRESENT, but not mounted in the current server: likely
legacy/unused.**

------------------------------------------------------------------------

# 38. GraphQL

The package contains:

``` text
backend/graphql/schema.js
backend/graphql/resolvers.js
```

The resolver layer uses Redis.

The current `server.js` does not expose a GraphQL endpoint.

Therefore GraphQL should not be considered part of the active API
surface without runtime evidence.

It should be classified as:

**Legacy / dormant candidate.**

------------------------------------------------------------------------

# 39. Legacy Nisarga Architecture

The package contains:

``` text
main-nisarga.js
backend/nisarga-server.js
backend/nisarga-utils.js
```

This represents a previous application generation.

The legacy server contains its own database configuration and route
expectations.

The presence of this parallel architecture indicates that the codebase
has undergone substantial historical evolution.

The future product should remove obsolete application generations rather
than carrying them forward.

------------------------------------------------------------------------

# 40. Migration Architecture

The migration directory contains several generations of schema
definitions.

Examples include:

``` text
products
product_categories
products_categories
orders
reports
cash_register
cashier_sessions
customers
settings
taxes
users
```

There are migrations that:

-   drop/recreate reports
-   create duplicate category concepts
-   alter tables under misleading migration names
-   remove columns that current models still conceptually depend on

Therefore the migration history cannot currently be treated as the
authoritative production schema.

Required next step:

``` text
Actual production DB schema
        +
Current models
        +
Migration history
        |
        v
Schema reconciliation document
```

------------------------------------------------------------------------

# 41. File Storage

The application stores files under local `tmp` directories.

Observed categories include:

``` text
products
reports
notes
temp
```

This is acceptable for a desktop-local application but not for global
SaaS.

Future architecture:

``` text
Application
   |
Media service
   |
Object Storage
   |
CDN
```

------------------------------------------------------------------------

# 42. Logging

Electron logging is enabled through `electron-log`.

The current application writes logs to a hard-coded Windows path.

This is fragile because the path is tied to a particular
developer/machine environment.

Future architecture should provide:

``` text
Structured local logs
+
Centralized telemetry
+
Error tracking
+
Audit logs
```

------------------------------------------------------------------------

# 43. Auto Update

The Electron application uses `electron-updater`.

The update provider is GitHub.

The application handles:

-   checking
-   available
-   unavailable
-   download progress
-   downloaded
-   restart/install

This is a useful capability that should remain in the future desktop
POS.

For SaaS, update channels should eventually support:

``` text
Stable
Beta
Canary
Tenant rollout
Terminal rollout
```

------------------------------------------------------------------------

# 44. Security Baseline --- Current State

Positive findings:

-   main renderer has `contextIsolation=true`
-   main renderer has `nodeIntegration=false`
-   passwords use bcrypt
-   JWT authentication exists
-   update mechanism exists
-   Electron IPC is exposed through contextBridge
-   application has some request validation via express-validator

Major concerns identified:

-   secrets/configuration exist inside the distributed desktop package
-   database connection information is embedded/configured for the
    desktop application
-   frontend build contains configuration/secrets that should not be
    treated as secret
-   CORS is unrestricted
-   multiple unauthenticated state-changing routes exist
-   state-changing operations use GET
-   authorization is weak
-   desktop client directly participates in database access
-   legacy credentials/configuration remain in old code
-   external integrations use embedded/static authentication patterns
-   no mature audit trail is evident
-   no tenant isolation exists
-   no robust device identity model exists

These are findings for remediation, not yet the complete security audit.

------------------------------------------------------------------------

# 45. Current Trust Boundary

The current trust boundary is weak.

Conceptually:

``` text
                  Internet
                     |
             Asmara Website
                     |
                     v
             Shared ecosystem
                     |
                     v
                Remote MySQL
                     ^
                     |
               POS Desktop
                     |
             Embedded backend
                     |
                React UI
```

The desktop application therefore has too much responsibility and too
much trust.

Target:

``` text
POS Desktop
     |
     | TLS
     v
API Gateway / API
     |
     +---- Auth
     +---- Tenant authorization
     +---- Business services
     +---- Audit
     |
     v
Database
```

The POS should not possess production database credentials.

------------------------------------------------------------------------

# 46. Current API Surface

Active route groups:

``` text
/auth
/tables
/menu
/items
/orders
/pos
/tax
/config
```

Important functional areas:

### Auth

-   signup
-   login
-   get current user
-   seed

### POS

-   items
-   session
-   opening cash
-   active session
-   customer creation
-   customers

### Orders

-   list
-   cancel
-   finish
-   create
-   link
-   init
-   kitchen
-   payment
-   view
-   info
-   last order
-   X report
-   Z report
-   reports
-   day close
-   remove report

### Items

-   list
-   update stock
-   create
-   import
-   update
-   remove
-   POS toggle
-   convert image
-   create custom

### Menu

-   list
-   create
-   update
-   remove
-   toggle
-   fill colors

### Tables

-   list
-   reservations
-   update position
-   split
-   free all

### Taxes

-   list
-   create
-   update
-   remove
-   toggle

### Config

-   stock alert
-   inventory
-   notifications
-   settings
-   database upload
-   daily reports
-   daily report time

------------------------------------------------------------------------

# 47. Current Frontend

The frontend is a compiled React application.

Observed technology:

-   React
-   React Router
-   Redux / Redux Toolkit
-   Axios
-   Pusher client library
-   Bootstrap-related assets
-   Styled-components-related runtime
-   Boxicons

The production frontend includes multiple code chunks.

No original React source tree is included in the package.

Therefore frontend architecture is partially reverse-engineered from the
production bundle.

------------------------------------------------------------------------

# 48. Frontend API Configuration

The production frontend contains configuration referring to:

``` text
https://asmara-eindhoven.nl/api
https://asmara-eindhoven.nl/storage
http://localhost:5101
```

It also contains client-side configuration values.

Important rule:

**Anything shipped inside a browser/Electron renderer bundle must be
considered public.**

Future SaaS secrets must never rely on frontend environment variables
for secrecy.

------------------------------------------------------------------------

# 49. Real-Time / Pusher

The frontend bundle includes Pusher.

This suggests the product has/had real-time capabilities.

However, the supplied backend does not expose a corresponding Pusher
server implementation in the current route architecture.

Therefore:

**Pusher: PRESENT IN CLIENT; ACTIVE PRODUCTION DEPENDENCY REQUIRES
RUNTIME VERIFICATION.**

If real-time synchronization is required, the SaaS architecture should
introduce an explicit event/realtime layer.

------------------------------------------------------------------------

# 50. Core Current Architecture Diagram

``` text
                     ASMARА WEBSITE
                          |
                    /api / storage
                          |
                          v
                 Remote Web Ecosystem
                          |
                          |
             +------------+-------------+
             |                          |
             v                          v
       Remote MySQL                Media/API
             ^
             |
       network / credentials
             |
     +-------+--------+
     |                |
     |   POS Desktop  |
     |                |
     | Electron       |
     |   |            |
     |   +--> React   |
     |   |            |
     |   +--> Express |
     |        |       |
     |        +--> Objection
     |        +--> Knex
     |                |
     |        +--> Reports
     |        +--> Scheduler
     |        +--> Files
     |        +--> Redis (partial)
     |        +--> SQLite (partial)
     |
     +--> Printer
     +--> Kitchen Printer
     +--> Cash Drawer
     +--> Customer Display
```

------------------------------------------------------------------------

# 51. Current Architecture Classification

  Component                    Status
  ---------------------------- ----------------------------------------------
  Electron desktop             ACTIVE
  React POS UI                 ACTIVE
  Embedded Express             ACTIVE
  MySQL                        ACTIVE / primary
  SQLite                       PARTIAL / unproven
  Offline synchronization      NOT PROVEN
  Objection.js                 ACTIVE
  Knex                         ACTIVE
  JWT                          ACTIVE
  bcrypt                       ACTIVE
  Customer display             ACTIVE capability
  Printing                     ACTIVE
  Kitchen printing             ACTIVE
  Cash drawer                  ACTIVE capability
  X report                     ACTIVE
  Z report                     ACTIVE
  Scheduler                    ACTIVE capability
  Redis                        PRESENT / role unclear
  GraphQL                      DORMANT/legacy candidate
  Pusher                       PRESENT in frontend / runtime role to verify
  Nisarga code                 LEGACY
  External product sync        ACTIVE-looking integration
  Website integration          CONFIRMED ecosystem relationship
  Reservation integration      NOT YET PROVEN
  SaaS tenancy                 NOT PRESENT
  Central audit system         NOT PRESENT
  Global tax engine            NOT PRESENT
  Global payment abstraction   NOT PRESENT

------------------------------------------------------------------------

# 52. Key Architectural Weaknesses

The most important architectural weaknesses are:

1.  Desktop application has too much backend/database responsibility.
2.  Remote database dependency is tightly coupled to POS.
3.  Offline mode is incomplete.
4.  No robust synchronization model.
5.  Tenant isolation does not exist.
6.  Authorization is weak.
7.  Transaction data is partially stored as JSON.
8.  Payment model is too simple.
9.  Database migrations are inconsistent.
10. Legacy code generations remain in the production package.
11. Local filesystem is used for important persistent artifacts.
12. Reporting is coupled to local PDF generation.
13. Configuration is overly user-centric rather than
    tenant/location-centric.
14. External integrations are hard-coded.
15. Kitchen routing is category-name based.
16. Real-time architecture is unclear.
17. No formal event architecture exists.
18. No formal audit ledger exists.
19. No production observability platform is evident.
20. No SaaS control plane exists.

------------------------------------------------------------------------

# 53. Business-Critical Data Domains

The future architecture must protect these domains as
financial/operational systems of record:

``` text
Orders
Payments
Taxes
Cash Registers
Z Reports
Refunds
Discounts
Products
Prices
Employees
Customers
Reservations
Inventory
```

These cannot be treated as casual CRUD records.

------------------------------------------------------------------------

# 54. What Must NOT Be Done

During remediation:

-   Do not immediately rewrite the whole application.
-   Do not disconnect the production Asmara POS without a migration
    plan.
-   Do not migrate the database blindly.
-   Do not replace MySQL before transactional behavior is mapped.
-   Do not enable untested offline mode in production.
-   Do not redesign working restaurant workflows without regression
    testing.
-   Do not remove legacy code until its runtime usage is proven.
-   Do not expose production credentials during debugging.
-   Do not make SaaS changes directly against the production customer
    without isolation.

------------------------------------------------------------------------

# 55. Target Architectural Direction

The future platform should evolve toward:

``` text
                    Global Restaurant SaaS
                             |
                    API / Application Layer
                             |
          +------------------+------------------+
          |                  |                  |
       Tenant A           Tenant B           Tenant C
          |                  |                  |
      Location 1         Location 1         Location 1
      Location 2         Location 2         Location 2
          |
     +----+--------------------------------+
     |                                     |
 POS Terminal                         Web Admin
     |                                     |
 Local DB / Offline                    Cloud API
     |
 Sync Engine
     |
     v
Cloud
```

------------------------------------------------------------------------

# 56. Future Tenant Hierarchy

Recommended hierarchy:

``` text
Platform
  |
Tenant / Organization
  |
Brand
  |
Location
  |
Floor
  |
Table
  |
Terminal
  |
Cash Register
```

Employees should be scoped appropriately:

``` text
Tenant
  |
Role
  |
Permission
  |
Employee
  |
Location access
```

------------------------------------------------------------------------

# 57. Future Core Domain Model

``` text
Tenant
 ├── Brands
 ├── Locations
 │    ├── Floors
 │    │    └── Tables
 │    ├── Terminals
 │    ├── Registers
 │    ├── Printers
 │    ├── Kitchen Stations
 │    └── Menus
 │
 ├── Employees
 ├── Roles
 ├── Customers
 ├── Products
 ├── Categories
 ├── Modifiers
 ├── Orders
 ├── Payments
 ├── Taxes
 ├── Reservations
 ├── Inventory
 ├── Suppliers
 ├── Reports
 ├── Integrations
 └── Audit Logs
```

------------------------------------------------------------------------

# 58. Future Offline-First POS

The correct future model is:

``` text
              CLOUD
                |
          Sync protocol
                |
        +-------+-------+
        |               |
     Terminal A      Terminal B
        |               |
     Local DB        Local DB
        |               |
      POS works       POS works
      offline        offline
```

Every offline transaction should have:

-   globally unique ID
-   device ID
-   tenant ID
-   location ID
-   terminal ID
-   sequence
-   timestamp
-   operation type
-   idempotency key
-   sync status

------------------------------------------------------------------------

# 59. Future Event Model

The platform should eventually emit domain events:

``` text
OrderCreated
OrderItemAdded
OrderSentToKitchen
OrderCompleted
PaymentCaptured
PaymentRefunded
RegisterOpened
RegisterClosed
ReservationCreated
ProductUpdated
InventoryAdjusted
```

This enables:

-   KDS
-   customer display
-   analytics
-   integrations
-   audit
-   notifications
-   synchronization

------------------------------------------------------------------------

# 60. Future Integration Architecture

External services must be behind adapters:

``` text
RestaurantOS
     |
Integration Layer
     |
 +---+----+---------+---------+
 |        |         |         |
Payment  Delivery  Booking  Accounting
Adapter  Adapter    Adapter   Adapter
```

No provider-specific code should leak into core order logic.

------------------------------------------------------------------------

# 61. Future Globalization

The platform should support:

-   multiple countries
-   multiple currencies
-   multiple languages
-   multiple time zones
-   country-specific tax
-   fiscalization
-   local payment providers
-   regional compliance
-   regional invoicing
-   local receipt requirements

The country-specific logic should be plugin/configuration driven.

------------------------------------------------------------------------

# 62. Future SaaS Control Plane

A global SaaS product requires a control plane:

``` text
Platform Admin
  |
  +-- Tenants
  +-- Plans
  +-- Feature Flags
  +-- Devices
  +-- Integrations
  +-- Support
  +-- Audit
  +-- System Health
  +-- Billing
```

Billing is intentionally not part of the current production POS
architecture; it belongs to the future SaaS control plane.

------------------------------------------------------------------------

# 63. Phase 1 Conclusions

The current Asmara POS is a functioning restaurant POS with real
production capabilities.

It is NOT yet a clean modern SaaS architecture.

It contains substantial useful business logic that should be preserved,
especially:

-   restaurant table operations
-   order flow
-   kitchen workflow
-   printing
-   cash register
-   X/Z reports
-   customer display
-   product/menu management
-   customer records
-   reservation-related surface
-   desktop update mechanism

The main problem is not that the system lacks business functionality.

The main problem is that the functionality has evolved inside a tightly
coupled, historically layered architecture.

------------------------------------------------------------------------

# 64. Phase 1 Confidence Model

### Confirmed from supplied package

-   Electron desktop architecture
-   embedded Express backend
-   React production frontend
-   MySQL primary configuration
-   Objection/Knex
-   authentication
-   route structure
-   menu/items/orders/tables/tax/config domains
-   printing
-   kitchen printing
-   cash drawer
-   customer display
-   reports
-   scheduler
-   SQLite switching code
-   Redis module
-   GraphQL code
-   legacy Nisarga code
-   external integration calls
-   website API/storage references

### Confirmed from live website

-   Asmara restaurant website exists
-   menu is published
-   reservation workflow exists
-   restaurant/location information
-   opening hours
-   menu content

citeturn0search0turn0search1turn0search2

### Not yet proven

-   exact production website → POS reservation data flow
-   exact production database schema
-   actual production Redis usage
-   actual Pusher production usage
-   actual SQLite/offline operation
-   actual synchronization/conflict handling
-   exact external product-service responsibilities
-   complete payment-provider integration
-   production backup/restore mechanism
-   production monitoring/alerting
-   all deployed server-side code outside the supplied desktop package

------------------------------------------------------------------------

# 65. Phase 1 Official Baseline

The current system should be treated as:

> **A production Electron restaurant POS, with an embedded Node/Express
> application layer and remote MySQL backend, augmented by local
> hardware integration and historical/partial offline, Redis, GraphQL,
> realtime, and external synchronization components.**

The architecture is **business-functional but technically coupled and
historically evolved**.

The correct next phase is therefore NOT SaaS development yet.

The correct next phase is:

# Phase 2 --- Production Architecture & Security Remediation

Before that phase begins, the following must be produced:

1.  Actual production database schema dump/metadata.
2.  Live website/API integration map.
3.  Production endpoint authentication matrix.
4.  Complete data-flow map.
5.  Payment flow map.
6.  Reservation flow map.
7.  Printer/device topology.
8.  Backup/recovery map.
9.  External integration inventory.
10. Runtime verification of Redis/Pusher/SQLite.
11. Legacy-code dependency map.
12. Security threat model.

Only after those are complete should destructive refactoring begin.

------------------------------------------------------------------------

## Final architectural principle

**Asmara is the first production tenant/reference implementation, not
the architecture of the future product.**

We preserve the proven restaurant workflows, extract the underlying
domain model, harden the production system, and then evolve it into a
tenant-aware, offline-first, globally deployable Restaurant SaaS
platform.
