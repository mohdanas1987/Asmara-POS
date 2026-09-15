# PRESERVATION-CONTRACT.md
**Governance item:** §1.A, Master Development Specification v2.0
**Status:** v1 — first pass, built from code-level discovery (Architecture Bible v1.0/v1.1). Marked wherever a line still needs live-system or restaurant-staff confirmation.
**Rule:** nothing on any register below may disappear simply because the architecture was refactored. Every phase report from here forward must include a "Preservation Contract check" confirming every register item it touched is still present and working.

Confidence key: **[CODE]** = confirmed by reading the actual extracted source. **[LIVE]** = still needs confirmation against the running restaurant system or its operators — not yet checked.

---

## 1. HARDWARE REGISTER

| Item | Detail | Confidence |
|---|---|---|
| Receipt/POS printer | Driven via Electron IPC channel `print-content`; renders an off-screen `BrowserWindow` loading a `data:text/html` receipt template, then prints. | **[CODE]** |
| Kitchen printer | Driven via IPC channel `print-to-kitchen`; same off-screen-window-print pattern, separate template. | **[CODE]** |
| Report printer / PDF output | IPC channel `print-report`; also used to generate the X/Z report PDFs stored under `tmp/reports`. | **[CODE]** |
| Printer discovery | IPC handler `get-printers` — returns the OS-visible printer list to the renderer for selection. | **[CODE]** |
| Cash drawer | IPC channel `draw-cash` → `openDrawer()` in the Electron main process. | **[CODE]** |
| Customer display | Second `BrowserWindow`, created only if a second monitor is detected, loading `http://localhost:5101/#/customer-screen`. Currently runs with `nodeIntegration: true` (main window correctly has it `false` — a known inconsistency, scheduled for fix in Stage 6/phase 52, not to be lost in that fix). | **[CODE]** |
| Printer routing configuration | Currently implemented as category-name string matching (e.g. treating "drinks" specially) inside the kitchen-ticket logic — fragile, scheduled for replacement in Stage 4/phase 40, but must remain functionally equivalent until that phase ships. | **[CODE]** |
| Exact printer models, connection type (USB/network/serial), physical driver names | Not derivable from source. | **[LIVE — needs restaurant staff input]** |

## 2. DATA REGISTER

| Item | Detail | Confidence |
|---|---|---|
| Products | `menu_items` table / `Item` model — name, image, category, price, quantity, unit, POS visibility, sales description, tax, code/barcode, deleted flag. | **[CODE]** |
| Categories | `menu_categories` table / `MenuCategory` model — name, color, status. | **[CODE]** |
| Product images | Stored under `backend/tmp/products/`, processed via `sharp` (resize/WebP conversion), also synced to `asmara-eindhoven.nl/storage` and pushed via `POST https://asmara-eindhoven.nl/api/update-product-image`. | **[CODE]** |
| Taxes | `taxes` table / `Tax` model — name, amount, status. | **[CODE]** |
| Customers | `Customer` model — name, phone (unique), email, title, street, state, city, notes. | **[CODE]** |
| Historical orders | `Order` / `OrderDetail` models — table association, customer, amount, JSON order data, payment mode, cashier, register, timestamps, status. | **[CODE]** |
| Reports | `reports` table / `Report` model, plus generated PDFs under `backend/tmp/reports/` (real historical X/Z reports observed dated back to March 2025 through March 2026). | **[CODE]** |
| Reservations | **At risk, not merely "preserve as-is":** the current `Reservation` model is a broken copy of `Report` mapped to the `reports` table. There is nothing real to preserve here except the table's `status` field including a `reserved` value. Stage 3/phase 26 replaces this with a real domain model — that phase's job is to *create* correct reservation persistence, not preserve broken persistence. | **[CODE]** |
| Tables | `Table` model — table_number, length, width, x, y, status, linked_to (floor position and linking). | **[CODE]** |
| Configuration | `settings` table / `Setting` model — user-scoped key/value pairs (inventory state, stock alert, last-updated date, etc.). | **[CODE]** |
| Local offline database | `backend/offline.sqlite` and `db.sqlite` referenced by `switchToSQLite()` — a real file exists in the shipped package. | **[CODE]** |

## 3. OPERATIONS REGISTER

| Item | Route / mechanism | Confidence |
|---|---|---|
| Direct sales | `POST /orders/create` without a table association | **[CODE]** |
| Table orders | `GET /orders/init/:table`, `POST /orders/create` with table association | **[CODE]** |
| Order modification | Order data updates via the order routes (item add/remove/quantity encoded in the JSON order payload) | **[CODE]** |
| Kitchen submission | `POST /orders/to-kitchen/:table?` | **[CODE]** |
| Payment | `POST /orders/payment-update` | **[CODE]** |
| Receipt | IPC `print-content`, triggered from `GET /orders/info/:order/:print?` | **[CODE]** |
| Reprint | Same `info/:order/:print?` route, print flag | **[CODE]** |
| X report | `POST /orders/x-report` | **[CODE]** |
| Z report | `POST /orders/z-report` | **[CODE]** |
| Day close | `GET /orders/day-close/:id` | **[CODE]** |
| Table split | `GET /tables/split-table/:table_number` | **[CODE]** |
| Table linking | `GET /orders/link/:tables` | **[CODE]** |
| Table transfer | **Does not exist yet.** Nothing to preserve — this is Stage 4/phases 33–36's new build, not a preservation item. Listed here only so its eventual addition to this register isn't forgotten once it ships. | **[CODE — confirmed absent]** |
| Cancel / finish order | `GET /orders/cancel/:order/:table`, `GET /orders/finish/:order/:table` — **both currently unauthenticated**, a Stage 2/phase 18–19 fix target; the *operation* must be preserved through that fix, only its access control changes. | **[CODE]** |

---

## 4. OPEN ITEMS BEFORE THIS CONTRACT IS "COMPLETE"

- Physical hardware register (printer models/connections) — needs a conversation with restaurant staff, not more code reading.
- Live confirmation that the deployed restaurant terminal matches this exact v5.0.4 build (the zip is a point-in-time snapshot).
- Final verification pass scheduled at Stage 12/phase 84, re-checking every row above against the fully hardened system before Asmara is certified.
