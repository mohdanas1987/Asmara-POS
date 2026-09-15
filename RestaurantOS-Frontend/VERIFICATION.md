# Verification log

This project can't be `npm install`-ed from this session directly (the bridge to your Mac
has narrower network access than your own Terminal). Every checkpoint below was instead
verified by staging the exact files into a separate cloud sandbox with real internet, running
`npm install`, and actually building/booting the app there — not just reading the code.

## 2026-09-11 — Login + POS screen
- `npm install`: succeeded (flagged `next@14.2.5` as having a known security vulnerability —
  upgraded to `14.2.35`, the latest patched 14.x release, reinstalled clean, no more warning).
- `npx tsc --noEmit`: 0 errors.
- `npx next build`: compiled successfully, both `/login` and `/pos` routes generated.
- `npx next start` + `curl`: both pages return HTTP 200 and server-render their real initial
  content (login form fields present; POS page's "Checking register status…" state present).

## 2026-09-11 — Tables (floor plan) screen
- `npx tsc --noEmit`: 0 errors.
- `npx next build`: compiled successfully, `/tables` route generated (2.75 kB).
- `npx next start` + `curl`: HTTP 200, server-rendered "Loading tables…" initial state confirmed.

## What this does NOT prove yet
None of this has been run against the actual live backend (Docker Desktop isn't reachable
from this session at all — see the earlier Docker Backend Test notes). Every API call was
written by reading the real route handlers in `Docker-Backend-Test/backend/routes/*.js` so
the request/response shapes match exactly, but an actual browser-to-backend round trip
(logging in, loading real menu items, opening a real register, charging a real order,
dragging a real table) has only been verified by you, manually, in your own Terminal +
browser — not by me. Please run `npm install && npm run dev` (with the backend running via
`docker compose up --build` in a separate terminal) and try it; tell me what breaks and I'll
fix it for real rather than guess.

## 2026-09-11 — Orders screen
- `npx tsc --noEmit`: 0 errors.
- `npx next build`: compiled successfully, `/orders` route generated (2.37 kB), 6 total routes.
- `npx next start` + `curl`: HTTP 200, server-rendered "Loading orders…" initial state confirmed.

## 2026-09-11 — Menu management screen
- `npx tsc --noEmit`: 0 errors.
- `npx next build`: compiled successfully, `/menu` route generated (2.69 kB), 7 total routes.
- `npx next start` + `curl`: HTTP 200, server-rendered "Loading menu…" initial state confirmed.

### Discovered while building this screen
`routes/items.js`'s `/items/remove/:id` (delete a product) calls an external third-party
endpoint, `https://pos.dftech.in/products/remove-product`, sending the product's data with an
`Authorization` header. This is a leftover vendor integration from wherever this codebase
originated -- not something introduced by this project. Delete-item functionality is
intentionally NOT built into the new Menu screen until this gets a real decision: strip the
external call server-side, or keep it and disclose it. Flagged, not silently worked around.

## 2026-09-11 — Website sync + Online Orders + PWA
Backend (new feature, `routes/website.js`, `migrations_local/0004_website_integration.js`):
- `node --test test/website.test.js`: 7/7 pass (real, against a real throwaway SQLite db).
- `node --test 'test/*.test.js'`: 33/33 pass — full existing Phase 1 suite still green, nothing broken.
- Booted the real server (`node server.local.js`) and ran a genuine end-to-end curl sequence:
  login → connect website → fetch menu feed with the real API key → post a simulated online
  order → confirmed it landed with `source: "online"`. Full transcript kept in this session's log.
- `npm install` flagged nothing new (socket.io added clean; `multer` and a few others were
  already flagged as outdated in the existing dependency tree, pre-existing, not touched here).

Frontend (`settings/website`, `online-orders`, PWA manifest/service worker, sidebar nav):
- First build caught a real bug: `OrderRow` was missing the new `source` field, so `tsc`
  failed on `online-orders/page.tsx`. Fixed, re-verified.
- `npx tsc --noEmit`: 0 errors. `npx next build`: compiled successfully, 9 total routes
  including `/settings/website` (3.2 kB) and `/online-orders` (15.1 kB, includes socket.io-client).
- `npx next start` + `curl`: both pages return HTTP 200 and server-render real content
  ("Website sync" / the connection guide; the online-orders gated empty state).

### Design decision: why this can be built and fully tested offline
Sync is pull-based (the website reads `/website/menu-feed`) and push-based the other way
(the website POSTs to `/website/orders`) -- the POS never dials out anywhere. That means this
feature is fully real and testable in Phase 1 without violating the "no contact with
srv1399.hstgr.io / the live website" rule, and it stays that way even after this goes live --
going live only means pointing the website's plugin at a real, reachable address instead of
`localhost:5102`.

### What's NOT yet real
No actual website exists to test this against -- everything above was verified with curl
standing in for "the website." The step-by-step guide in the Settings page describes how a
real WordPress/WooCommerce-style ordering plugin would use these two endpoints, but that has
not been tried against your actual live website (and per the standing rule, won't be without
your explicit go-ahead, since asmara-eindhoven.nl must never be touched casually).

### Cross-platform decision
Windows/macOS/Linux laptops and desktops, and tablets, are already covered today -- this is a
responsive web app, works in any modern browser. Added a PWA manifest + minimal service
worker so it's also installable ("Add to Home Screen" / "Install app") on Android, iOS
Safari, and desktop Chrome/Edge -- one codebase, no separate builds. Icons are placeholder
solid-brand-color squares (`public/icon-*.png`), real branding can replace them anytime.
True native App Store / Play Store apps (via Capacitor, wrapping this same web app) are a
distinct, larger task -- needs developer accounts, signing certificates, and app store
review -- logged separately, not silently promised as done here.

## 2026-09-11 — Desktop shell, setup wizard, hardware layer
`RestaurantOS-Desktop/` (new): `main.js`, `preload.js`, `hardware.js` — all pass `node --check`
(real syntax validation, run on the actual files). This is the Electron shell that runs the
backend + frontend as local child processes on the POS machine itself (local-first: no
network required for orders, printing, or the cash drawer).

Frontend: added `/setup` (the configuration wizard — mode selection, printer scan, second-
screen note, barcode scanner test, payment terminal toggle, kitchen display toggle, review)
and `/customer-display` (loaded by the desktop shell's second monitor window).
- `npx tsc --noEmit`: 0 errors. `npx next build`: compiled successfully, 11 total routes.
- `npx next start` + `curl`: both new pages return HTTP 200 and server-render real content.

### Honest limitation — hardware is real code, not verified against real hardware
`hardware.js` is written against the real ESC/POS protocol and real npm packages (`escpos`,
`escpos-usb`, `escpos-network`, `escpos-bluetooth`) — not a mock. But those packages need
native compilation per target machine and were NOT installed or run here, because there is no
physical printer, scanner, cash drawer, or payment terminal attached to this session to test
against. Every printer function degrades gracefully (reports "unavailable") rather than
crashing when those drivers are missing. Barcode scanners need no code at all here — they're
HID keyboard-emulation devices in the overwhelming majority of cases, confirmed by how the
wizard's scanner-test step works (a plain focused text input). Payment terminal support is a
placeholder only — no provider (Stripe Terminal / Adyen / SumUp / etc.) has been chosen yet,
and building real integration without a physical terminal and a chosen provider would just be
fabricated code pretending to work. This entire section needs a real machine with real
peripherals to actually prove out — flagged here rather than glossed over.

### Cloud sync layer (multi-branch)
Not yet built — the wizard now records the mode choice (`standalone` vs `cloud`) and, for
`cloud` mode, a branch name, but nothing currently acts on that yet. The actual sync engine
(queueing local changes, pushing/pulling against a central account when online) is a real
piece of infrastructure work, tracked as its own task, not stubbed here.

## 2026-09-11 — Payment terminal support (Stripe Terminal, Adyen, SumUp, Mollie)
Backend (`payments/{stripe,adyen,sumup,mollie}.js`, `routes/payments.js`,
`migrations_local/0005_payment_terminals.js`, `models/PaymentTerminalSettings.js`):
- Real per-tenant table (`payment_terminal_settings`) — deliberately NOT the generic `settings`
  table, which is scoped per-tenant-AND-per-user and wrong for a restaurant-wide fact like
  "which payment provider is connected."
- Shared adapter interface (`isConfigured`, `createTerminalPayment`, `checkStatus`) — the
  router never talks to a provider SDK directly.
- `node --test test/payments.test.js`: 9/9 pass. `node --test 'test/*.test.js'`: 42/42 pass —
  full suite still green, nothing broken by this feature.
- Real, honest external-API test: booted the actual server and called `POST /payments/connect`
  + `POST /payments/charge` for the Stripe adapter with a bogus key (`sk_test_bogus`). The
  adapter genuinely reached Stripe's real API over the network and got a real error back —
  `{"status":false,"message":"Invalid JSON received from the Stripe API"}` — proving the wiring
  is real (not a stub returning a fake success) without needing a real Stripe account.
- Adyen, SumUp, Mollie adapters are real, protocol-correct code against each provider's
  documented API shape, but have NOT been exercised against a real account/terminal — no
  credentials for those three were available to test with. SumUp specifically has no official
  Node SDK, so it calls SumUp's REST API directly via `fetch()`; flagged in the code as the
  adapter with the least certainty since exact endpoint shapes couldn't be cross-checked
  against a live SumUp integration.

Frontend (`settings/payments`, `usePaymentStatus` hook, `types.ts`/`api.ts` additions, the
setup wizard's payment step, sidebar nav):
- `npx tsc --noEmit`: 0 errors.
- `npx next build`: compiled successfully, 12 total routes including `/settings/payments`
  (2.75 kB).
- `npx next start` + `curl`: `/settings/payments` returns HTTP 200 and server-renders the real
  provider selector (Stripe Terminal / Adyen / SumUp / Mollie all present in the rendered HTML).
- The setup wizard's payment step was edited to link to `/settings/payments` instead of a bare
  "not wired up" note. Because the wizard is a multi-step client component, that link doesn't
  appear in `/setup`'s initial (step 1) server-rendered HTML — confirmed instead by grepping the
  compiled client JS bundle (`.next/static/chunks/app/setup/page-*.js`) for the literal link
  markup and text, which is present verbatim.
- Sidebar previously only linked to `/settings/website` under "Settings" — added a dedicated
  "Payments" entry (`/settings/payments`) alongside a renamed "Website Sync" entry, so both
  settings pages are reachable from every screen. Re-verified with a full `tsc` → `build` →
  `next start` → `curl /pos` pass; the real rendered HTML of a booted page contains both
  "Website Sync" and "Payments" nav links.
- Change written back to the source file on your Mac directly (not just in the sandbox copy)
  and confirmed byte-for-byte via `cat` after writing.

### Known dependency vulnerabilities — not yet fixed
`npm audit` on this pass flagged 5 vulnerabilities (4 high, 1 critical) in `next@14.2.35` and
its transitive `postcss`/`glob` dependencies — mostly Server-Components/Image-Optimizer/cache
DoS and RCE advisories that affect the entire Next.js 14.x/15.x line, only resolved in the
newest `next@16.x`. Unlike the earlier `14.2.5 → 14.2.35` patch bump, fixing this for real means
a major-version upgrade (`npm audit fix --force` pulls in `next@16.3.4` and
`eslint-config-next@16.3.4`), which is a breaking change to the App Router setup this whole
project is built on. Not done silently as part of this verification pass — flagged here as a
real, current issue that needs its own dedicated upgrade-and-reverify pass before this goes
anywhere near production traffic.

### What this does NOT prove
No real Stripe/Adyen/SumUp/Mollie merchant account or physical card-present terminal was
available to test a full successful charge end-to-end — only that each adapter's wiring is
structurally correct and (for Stripe) genuinely reaches the real provider API. A real terminal
pairing/charge flow still needs to be tried with real hardware and real provider credentials
before this is "done" in the way a restaurant could actually take a card payment with it.


## 2026-09-11 — Weighing scale hardware integration (weight-based products)
Requested for products sold by weight (produce, deli, bulk bins) rather than by unit count:
put the item on the scale, pick it in the POS, weight × price-per-unit becomes the line price.
Supports USB, RS232, and old-style "telephone port" (RJ11/RJ12) scales uniformly under one
'serial' transport (they all present as a virtual COM port to the OS once wired into the
machine via a USB-to-serial adapter or a scale's built-in USB-serial chip), plus Ethernet/
network scale indicators over plain TCP. Auto-detect scans available serial ports at common
baud rates, and does a best-effort TCP connect-scan across a /24 subnet for network scales.

Backend (`migrations_local/0006_weight_items.js`, `routes/items.js`, `routes/pos.js`):
- Added `sold_by_weight` (boolean) and `weight_unit` ('kg'|'g'|'lb') to `menu_items`. When
  true, the existing `price` column is interpreted as price-PER-UNIT rather than price-per-item
  — no schema change needed for that, just a documented reinterpretation.
- `node --test test/weight-items.test.js`: 5/5 pass (create normal item, create weight item,
  admin item list returns both fields, POS item feed returns both fields, update can turn
  weight-mode on for an existing item). `node --test 'test/*.test.js'`: 47/47 pass — full
  suite still green.

### Two real, pre-existing bugs discovered and fixed while writing this test suite
Neither is related to weight support — both were just never exercised by any prior test that
did a real `/items/create` or `/items/update` round trip:
1. **Crash on item creation with no category** — `/items/create` called
   `ProductCategory.query().where('id', req.body.category_id)` unconditionally; if no category
   was selected, `category_id` is `undefined` and knex/objection throws
   `"undefined passed as argument #1 for 'where' operation"`, crashing the request with a 500.
   Guarded with a plain `req.body.category_id ? ... : null` check.
2. **`/items/create` and `/items/update` always failed** — both destructure `queueProduct`
   from `../utils`, but `utils.js`'s `module.exports` never actually defines that name, so
   calling it threw `"queueProduct is not a function"` on every single call, even though the
   item was already correctly inserted/updated in the database by that point. This means the
   Menu screen's create/update-item backend routes have been silently broken this whole time —
   not by anything built this session, just never caught before because no earlier test called
   them end-to-end. Guarded (skips the dead "queue product elsewhere" call with a console
   warning) rather than silently deleted, since the intent behind that call is unknown and it
   may be finished properly later.

Both fixes are isolated, defensive guards — nothing about existing working behavior was
changed or removed, consistent with the standing Preservation Contract.

### Desktop shell (`RestaurantOS-Desktop/scale.js`, new)
Real, protocol-correct code (not a mock), same honesty standard as `hardware.js`:
- **Parser logic — genuinely verified**, no hardware needed: `node --test scale.test.js`
  (run directly on your Mac): 7/7 pass. Covers Toledo/CAS-style `ST,GS,+1.234kg` / `US,GS,...`
  framed readings, STX/ETX byte stripping, a generic regex fallback for scales with a
  different exact format, missing-unit defaulting to kg, garbage-input rejection, and `lb`
  unit handling.
- **Network transport — genuinely verified end-to-end**, not just unit-tested in isolation: a
  real local TCP server was started on a throwaway port, streaming a real `ST,GS,+4.560kg`
  line every 200ms. `discoverNetworkScales` found it for real; `connectScale({transport:
  'network', ...})` genuinely connected; a real `weight` event came through the module's
  event bus with the correct parsed value; `getLastReading()` reflected it; `disconnectScale()`
  cleanly tore the connection down. This proves the actual network code path works correctly
  over a real socket — it does not prove any specific real network scale's exact byte format
  matches what's implemented here.
- **Serial transport and hardware auto-detect — UNVERIFIED against real hardware**, exactly
  like the printer layer: `serialport` (the npm package for real dependency reasons — native
  compilation per target machine) is not installed in this development sandbox, and there is
  no physical scale or serial cable attached to test with. Confirmed the graceful-degradation
  path works for real, though: with `serialport` absent, `listSerialPorts()` returns an
  honest "driver not installed" entry and `autoDetectSerialScale()` returns `null` rather than
  crashing — checked by actually running both functions in that exact missing-package state.
- IPC wired into `main.js`/`preload.js`: `hardware:listScales`, `hardware:autoDetectScale`,
  `hardware:discoverNetworkScales`, `hardware:connectScale`, `hardware:disconnectScale`,
  `hardware:getScaleReading`, `hardware:isScaleConnected`, plus a push channel
  (`hardware:scale-weight` / `hardware:scale-error`) so the POS gets live readings instead of
  polling. `node --check` passes on all of `main.js`, `preload.js`, `scale.js`, `scale.test.js`.
  `serialport` + `@serialport/parser-readline` added to `package.json` dependencies (not yet
  `npm install`-ed on a real machine — no native compilation attempted here).

### Frontend (POS weighing flow)
- `src/lib/desktop.ts`: typed wrapper for every scale IPC call above.
- `src/lib/types.ts`: `MenuItem.sold_by_weight` / `.weight_unit`; `CartLine.weight` +
  `.lineKey` (each weighing of a weight-based product is its own cart line — quantities don't
  merge the way normal items do, since two weighings are two different real amounts).
- `src/lib/hooks/useCart.ts`: `addWeighedItem(item, weight)`; `subtotal` now prices weighed
  lines as `price-per-unit × weight` instead of `price × qty`.
- New `pos/components/WeighItemModal.tsx`: shows the live scale reading with a stability
  indicator (stable/settling/reading), computed line price, and falls back to manual weight
  entry when no desktop bridge or no connected scale is present — same degrade-gracefully
  pattern as the rest of the hardware layer.
- `ProductGrid.tsx` routes a tap on a `sold_by_weight` item to the weigh modal instead of
  adding it straight to the cart, and shows a "⚖ Sold by weight" badge + per-unit price.
  `Cart.tsx` shows weighed lines with their actual weight and unit instead of a quantity
  stepper (editing a settled weighing in place doesn't make sense — remove and re-weigh
  instead).
- `npx tsc --noEmit`: 0 errors. `npx next build`: compiled successfully, 12 routes, `/pos`
  grew from 4.35 kB to 5.45 kB reflecting the new code. `npx next start` + `curl /pos`: HTTP
  200. Because the product grid is client-rendered from a live API call, the new strings
  don't appear in the raw server-rendered HTML (same situation as the setup wizard's payment
  link) — confirmed instead by grepping the compiled client JS bundle
  (`.next/static/chunks/app/(dashboard)/pos/*.js`) for the literal strings "Sold by weight",
  "No scale connected", "Line total", and "Add to order", all present verbatim.

### Order submission: what changed and why it's safe
`/orders/to-kitchen`'s existing `data.quantity` record is real, live business logic on the
backend (used for stock-decrement bookkeeping and the kitchen ticket's product list) — not
just opaque pass-through JSON. To avoid touching that logic blind, weighed lines still
contribute `quantity[item.id] += 1` per weighing (one sale event), and the actual weight/unit
detail travels alongside in a new, additive `data.weights` map for receipt/kitchen display
("1.234 kg" instead of "×1") — nothing the backend already does with `quantity` was changed.
The charged total (`cart.total`) was already computed and sent by the client before this
feature existed, so weight-based pricing correctness rests entirely on the (now real, tested)
frontend cart math, not on any new backend trust.

### What's NOT done / genuinely open
- **The Menu admin screen has no create/edit-item form yet at all** (it currently only creates
  categories, edits stock quantity, and toggles POS visibility) — so there is no UI yet for a
  cashier/admin to actually flip "sold by weight" on for a product. The backend fully supports
  it (tested above); building that form is part of the already-tracked, in-progress "remaining
  restaurant screens" task, not new scope from this feature.
- Whether stock for a weighed product should be decremented by weight (kg sold) or by sale
  count is a genuine, undecided product question — this pass deliberately did not guess at
  it and left `quantity` behavior unchanged.
- Real hardware verification (an actual scale, actual serial cable, actual COM port on the
  real POS machine) has not happened and can't happen in this sandbox — this is explicitly
  left for testing on the real machine, per your own instruction not to block on that here.


## 2026-09-11 — Remaining restaurant screens: Menu item form, Customers, Reports, Kitchen Display
Closes out the last of task #17's "remaining restaurant screens" list.

### Menu item create/edit form (`menu/components/ItemFormModal.tsx`)
The first UI in this app to actually call `/items/create` and `/items/update` end to end —
includes the "sold by weight" toggle + unit selector from the scale feature, so an admin can
now flip that on for a real product through the UI, not just via the API. Uses a new
`apiFetchForm` helper (deliberately omits the JSON Content-Type header so the browser sets its
own multipart boundary -- these two backend routes use multer's `upload.single()`, not JSON).

### Customers (`customers/page.tsx`) and Reports (`reports/page.tsx`)
Both wire up existing, already-real backend routes that had no frontend yet: `/pos/customers`
+ `/pos/create-customer`, and `/orders/x-report` + `/orders/z-report` + `/orders/reports` +
`/orders/remove-report`. Z report is gated behind an inline confirmation (it closes the
register session and frees every table -- a real, consequential action, not a preview).

### Kitchen Display (`kitchen/page.tsx`) + real-time "accept" flow (new backend routes)
Implements the original requirement in full: online orders need to be explicitly accepted
before the kitchen sees them, and the kitchen ticket board clearly distinguishes an online
order from a table order.
- New backend routes `/orders/accept/:order` and `/orders/prepared/:order`
  (`routes/orders.js`) -- deliberately NOT built by reusing `/to-kitchen` or `/finish`:
  `/to-kitchen` builds its `data.quantity` from a POS-drafted cart and would have silently
  overwritten an online order's already-stored `{items, customer_name}` data; `/finish`
  requires a `:table` param and calls `.split('+')` on it, which throws for any order with no
  table (every online order, and POS "direct sale" orders, both have `tables: null`). The two
  new routes only ever touch `status`, so neither hazard applies.
- `node --test test/kitchen.test.js`: 4/4 pass -- accepting a tableless online order moves it
  to in-kitchen with its original item data byte-for-byte intact; marking a tableless order
  prepared completes it without crashing; marking a real table order prepared frees that
  table; a cross-tenant accept/prepare attempt is refused. `node --test 'test/*.test.js'`:
  51/51 pass -- full suite still green (up from 47).
- Real-time: `/orders/accept` and `/orders/to-kitchen` both now emit a `order-to-kitchen`
  socket event (same pattern as the existing `online-order` push in `routes/website.js`), so
  a new ticket -- whether a just-accepted online order or a POS-drafted table order sent to
  the kitchen -- appears on the Kitchen Display instantly, no polling or refresh.
- Online Orders page gained an "Accept order" button per pending order, calling the new
  `/orders/accept` route; once accepted it shows "✓ Sent to kitchen" instead.
- Sidebar gained a "Kitchen Display" entry between Online Orders and Menu.

### Full verification, same rigor as every prior feature
- `npx tsc --noEmit`: 0 errors across all new/changed files.
- `npx next build`: compiled successfully, 17 total routes (up from 12) --
  `/customers` (2.9 kB), `/kitchen` (2.76 kB), `/reports` (2.94 kB), `/menu` grew from
  2.83 kB to 4.47 kB with the new item form.
- `npx next start` + `curl`: all four new/changed routes return real HTTP 200 with real
  server-rendered content (confirmed directly in the raw HTML for the Sidebar's new "Kitchen
  Display" link, and via the compiled client JS bundle for the client-rendered page bodies --
  same technique used for every prior client-rendered screen in this app, since a plain curl
  of a client component's initial HTML doesn't show data loaded after mount).

### What's NOT done / genuinely open
- Report HTML is rendered with `dangerouslySetInnerHTML` on the Reports page. This is safe
  here specifically because that HTML is generated server-side by this app's own
  `generateReport()` (`utils.js`) from real order data in this same trusted backend -- not
  user-supplied or third-party content -- but it's worth knowing this pattern is not
  automatically safe to copy elsewhere.
- No pagination or search on Customers/Reports lists yet -- fine at the current data volumes
  in Phase 1 testing, a real concern once a restaurant has thousands of customers or months
  of reports; not solved here since it wasn't part of the original ask and would be guessing
  at a real restaurant's actual scale.
- Kitchen Display shows every in-kitchen order in one flat list; a real kitchen with print
  stations per section (grill, cold, drinks) would want routing/filtering by category --
  flagged as a real, likely next ask rather than silently built in without being requested.


## 2026-09-11 — Tenant onboarding (real signup) + Super-admin panel
Two of the four remaining big pieces (billing and native app packaging are next). Built in
dependency order: onboarding first since super-admin's tenant list needs real tenants to list.

### Real tenant signup (closes a Phase 1 build-plan gap)
New `POST /auth/signup-tenant` (`routes/auth.js`) creates a brand-new restaurant (`tenants`
row) + its first admin user in one Objection transaction, auto-generates a de-duplicated slug
from the restaurant name, and logs the new admin straight in with a real JWT.
- **A second real, pre-existing bug discovered while building this** (separate from the two
  found earlier in `items.js`): the OLD `/signup` route's duplicate-email check --
  `User.query().where('email', ...)` with no `.first()` -- returns a query-builder promise
  that resolves to an ARRAY, which is truthy even when empty. That means the "email already
  exists" branch fires on literally every signup attempt through that old route, so it has
  never been able to succeed. Left untouched (Preservation Contract; that route was already
  flagged as unused, and fixing it wasn't asked for) but documented here rather than found
  and quietly ignored -- the new `/signup-tenant` route uses `.first()` correctly and was
  tested for exactly this failure mode.
- `node --test test/tenant-onboarding.test.js`: 5/5 pass -- creates tenant + admin and logs
  them in; **the new tenant is fully isolated from tenant 1's data** (checked for real: a
  fresh signup's `/tables` call returns zero rows, not tenant 1's seeded tables); two
  restaurants named identically get distinct slugs (`pizza-place`, `pizza-place-2`); duplicate
  email is rejected; short password / bad email is rejected with 400.
- Frontend: new `/signup` page (`(auth)/signup/page.tsx`), linked from `/login`.

### Super-admin panel
- New `platform_admin` role: a `users` row with `type: 'platform_admin'`, gated by a new
  `middlewares/requirePlatformAdmin.js` used in front of every route in the new
  `routes/superadmin.js`. Deliberately has NO public signup path (unlike restaurant
  onboarding) -- creating one is an operator action (direct DB / seed script), since it grants
  real cross-tenant read access to every restaurant on the platform. This matches the build
  plan's own framing ("safe support tools, view-only by default").
- Routes: `GET /superadmin/tenants` (every tenant with real aggregated usage -- user count,
  order count, most recent order date, all computed with real SQL aggregates against the
  actual multi-tenant data, not per-tenant loops), `GET /superadmin/tenants/:id` (detail),
  `POST /superadmin/tenants/:id/toggle` (suspend/reactivate -- the only mutation in the whole
  file, and non-destructive: flips `status`, never deletes anything).
- `node --test test/superadmin.test.js`: 5/5 pass -- a normal tenant admin gets a real 403
  (not silently filtered data); an unauthenticated request gets 401; a platform admin sees
  every tenant including a freshly seeded second one with real aggregated order counts;
  tenant detail works; suspending then reactivating a tenant round-trips correctly and its
  orders are still there throughout (toggling status never touches the tenant's actual data).
  `node --test 'test/*.test.js'`: 61/61 pass -- full suite still green (up from 56).
- Frontend: new `/admin` page, deliberately OUTSIDE the `(dashboard)` route group/Sidebar --
  this is a cross-tenant operator view, not a restaurant's own screen. Shows a real 403 message
  inline (not a silent blank page) when a non-platform-admin token is used, since there's no
  way to know client-side whether someone is a platform admin before asking the server.

### Full verification, same rigor as every prior feature
- `npx tsc --noEmit`: 0 errors. `npx next build`: compiled successfully, 19 total routes
  (up from 17) -- `/admin` (2.65 kB) and `/signup` (2.83 kB) both new.
- `npx next start` + `curl`: both new routes return real HTTP 200 with real server-rendered
  content in the raw HTML (`/signup`'s form fields are server-rendered since it has no data
  fetch before paint; `/admin`'s static shell -- title, disclaimer text, "Loading…" state --
  is server-rendered, with the actual tenant table populating client-side after the
  platform-admin-gated API call, same as every other data-driven screen in this app).

### What's NOT done / genuinely open
- There is still no in-app way to create the FIRST platform admin -- by design (see above),
  but it means going live with a real super-admin panel needs one manual DB insert or a small
  one-off seed script run by you, not something this session can or should automate.
- No billing/plan data exists yet, so the super-admin tenant list doesn't show subscription
  status -- that's next, and needs your input on real plan tiers/pricing before it can be
  built for real rather than guessed at.


## 2026-09-11 — Billing groundwork (dynamic plans/partners) + native packaging

The last two of the four remaining big pieces from the build plan. Per explicit instruction,
billing is built as a fully dynamic system the platform admin manages themselves (no hardcoded
tiers), and native packaging targets Windows (.exe, primary), an Android sideload-only thin
client, and macOS best-effort -- not the iOS/Android app stores.

### Billing: dynamic plans, payment partners, and subscriptions -- nothing hardcoded
New tables (`0007_billing` migration): `plans`, `payment_providers` (platform billing
partners -- distinct from the in-restaurant payment TERMINAL providers already built),
`subscriptions` (one per tenant, linking to a plan + provider + status). New
`routes/billing-admin.js` (platform-admin-gated, same `requirePlatformAdmin` middleware as
the rest of the super-admin panel) gives full CRUD over plans and payment partners --
create, edit, price, feature-list, activate/deactivate, and assign a tenant's subscription --
and a new public `routes/billing.js` (`GET /billing/plans`, unauthenticated) feeds the signup
form. Nothing in any of this processes a real charge: every payment partner defaults to
`mode: 'sandbox'`, and there is still no live payment-provider SDK call anywhere in this
codebase -- see the original build plan's "explicitly deferred" section, now resolved by
letting the *admin* pick the pricing dynamically rather than this build guessing at it.

- `node --test test/billing.test.js`: 9/9 pass, `node --test 'test/*.test.js'`: **69/69 pass**
  (up from 61). Covers plan CRUD, payment-partner CRUD, the public plan list only showing
  active plans, a new tenant signing up with a chosen plan (or falling back to the platform
  default), and a platform admin directly assigning/changing a tenant's subscription.
- **A real bug the tests caught**: deactivating a plan didn't clear its `is_default` flag,
  so a plan could stay the auto-offered signup default while also being inactive -- meaning
  a new restaurant that didn't pick a plan explicitly would silently end up with NO plan at
  all (the fallback query requires both `is_default` and `is_active`). Fixed in
  `routes/billing-admin.js`'s PATCH handler: deactivating a plan now always clears its
  default flag too. Caught by `billing.test.js`'s "signing up without picking a plan"
  test failing on a null plan before the fix, passing after.
- Frontend: `/signup` now fetches the live plan list and lets a prospective restaurant pick
  one (falls back to the platform default, or no plan step at all if none exist yet); new
  `/admin/billing` page gives the platform admin full plan/payment-partner management with
  add/edit/activate/deactivate forms; `/admin`'s tenant table now shows each tenant's current
  plan name and subscription status. `npx tsc --noEmit`: 0 errors. `npx next build`: 20 total
  routes (up from 19), new `/admin/billing` at 4 kB. `next start` + curl: all three
  new/changed pages return 200 with real content (server-rendered shell verified via raw
  curl'd HTML; client-fetched plan/tenant data verified via grepping the compiled
  `.next/static/chunks/app/**` bundles for the actual UI strings).

### Native packaging -- and three real bugs found only by actually launching the app

The build plan's packaging task was still just aspirational code (`main.js` spawning a
backend and frontend process) that had never actually been launched end-to-end. Packaging it
properly meant testing it for real first -- and running the ACTUAL Electron app (under Xvfb,
since the verification sandbox has no display) surfaced three genuine, previously-invisible
bugs that no amount of `node --check` or `tsc` could have caught, because they only appear
when the process is actually spawned as a child of a running app:

1. **The backend never started at all.** `spawnChild(process.execPath, ['server.local.js'], ...)`
   spawns `process.execPath` -- Electron's own binary -- but without the
   `ELECTRON_RUN_AS_NODE=1` environment variable, that just launches a SECOND full Electron
   GUI instance pointed at that path as an app, not a plain Node script. Every real launch
   crashed the "backend" child immediately with `Running as root without --no-sandbox is not
   supported` (a Chromium sandbox error, meaningless for what was supposed to be a headless
   Express server) -- meaning no order, table, or menu data was ever reachable in the desktop
   app, silently, in every previous state of this code. Fixed by a new `spawnNodeScript()`
   helper that always sets `ELECTRON_RUN_AS_NODE: '1'` -- this is the documented, standard way
   to run a plain script with Electron's bundled Node, which is also what makes the packaged
   app not need a separate Node.js install on the target machine at all.
2. **The frontend depended on `npx`.** `spawn('npx', ['next', 'start', ...])` needs either a
   global `next` install or a live network fetch to resolve the package -- neither exists on
   an offline restaurant POS machine. Fixed by resolving Next's own compiled CLI entry
   (`next/dist/bin/next`) directly out of the frontend's bundled `node_modules` via
   `require.resolve`, run through the same `spawnNodeScript()` helper -- no `npx`, no network,
   guaranteed to be the exact Next.js build that was tested.
3. **A fixed 3-second `setTimeout` before opening the window**, with no real readiness check
   -- replaced with a real HTTP poll (`waitForHttp`) against the backend's own
   `/check-connection` route and the frontend's root, so a slower first boot (Next.js
   compiling routes on demand, or a slower machine) doesn't silently point the window at a
   server that isn't listening yet.

Fixing those and re-launching (same Xvfb harness) surfaced two more, only visible once the
app was actually **packaged** (not just run from the dev folder):

4. **Missing `JWT_SECRET`.** The backend refuses to start without one (Stage 2's fix for the
   old hardcoded-secret vulnerability -- see `config/auth.js`), and a packaged app ships no
   `.env` file (deliberately -- a dev `.env` must never end up inside a shipped installer).
   Fixed by generating a random 48-byte secret on first run and persisting it via
   `electron-store` (already a dependency) in this machine's own userData directory --
   never inside the app's own install folder -- and passing it to the spawned backend as an
   environment variable.
5. **The SQLite database would have lived inside the app's own install folder**
   (`./local_test.sqlite`, relative to `cwd`). On a real Windows install under Program Files
   that's normally not even writable by a standard user, and on any OS it gets wiped by every
   update or reinstall -- a real data-loss risk for a restaurant's live order/menu/table data.
   Fixed with a new `RESTAURANTOS_SQLITE_PATH` override in `knexfile.local.js` (falls back to
   the original relative path when unset, so the existing dev/test workflow is untouched),
   pointed by `main.js` at Electron's userData directory instead.
6. Also added: the backend's direct-run entrypoint (`node server.local.js`, i.e. what the
   packaged app actually runs) now calls `knex.migrate.latest()` automatically before
   listening -- a restaurant owner double-clicking an .exe has no terminal to run
   `knex migrate:latest` by hand, and this makes every future update (new migrations included)
   self-applying on next launch, exactly like the rest of this project's migrations already
   work in the test suite.

**Full real verification of the fix**, not just code review: staged the desktop shell,
backend, and frontend into the cloud sandbox (real network), ran `npm install` for all three,
`next build`, migrated a fresh SQLite database, and launched the actual Electron app under
Xvfb (`xvfb-run ... electron . --no-sandbox`) four times across the fix iterations --
confirmed via `curl http://localhost:5102/check-connection` (`{"status":true,"message":"Local
SQLite connected."}`) and `curl http://localhost:3000/pos` (real 200) that both processes were
genuinely up and serving, not just "should work" from reading the code.

### Electron-builder packaging config -- built and verified as far as this sandbox allows
Added a real `build` config to `RestaurantOS-Desktop/package.json` (electron-builder, not the
old app's `electron-packager` -- more standard, and gives Windows a proper installer AND a
portable single .exe in one config): `win` targets both `nsis` (installer) and `portable`
(closest match to "run like an .exe in Windows as the current POS does" -- no install step at
all), `mac` targets `dmg`+`zip` with `identity: null` (explicitly unsigned -- no Apple
developer account needed, per instruction to skip that for now), backend+frontend bundled as
`extraResources` so the packaged app is self-contained. Icons reused from the current live
app's own `asmara.ico`/`logo.png` (resized to a proper square 1024x1024 for cross-platform
icon generation).

- **Real, full build-and-launch verification on Linux** (the one platform this sandbox can
  both build AND run): `npx electron-builder --linux AppImage` produced a real 275 MB
  self-contained package; ran the actual packaged binary (`dist/linux-unpacked/restaurantos-
  desktop`, not the dev folder) under Xvfb from a completely clean state (no pre-existing
  database, no persisted config) and confirmed via curl that the backend auto-migrated a
  fresh database (all 7 migrations, including this same session's own `0007_billing`),
  generated and used a real JWT secret, and both processes came up and served real content --
  and confirmed via `find` that the database landed in `~/.config/restaurantos-desktop/`
  (the Linux equivalent of the userData fix above), never inside the packaged app's own
  `resources/` folder.
- **Windows and macOS binaries were NOT generated in this sandbox** -- genuinely, not a
  guess: cross-building a Windows target from Linux needs Wine, which failed to install here
  (`apt-get install wine64` hit a 404 on an unrelated transitive dependency,
  `libgphoto2-*`, from this sandbox's package mirror -- confirmed with `--no-install-
  recommends` too, same failure); a macOS target cannot be cross-built from Linux at all,
  full stop, regardless of tooling (electron-builder itself requires a macOS host for that).
  The config itself is verified correct by the equivalent, successful Linux build above (same
  `extraResources`/`asar`/spawn logic, same electron-builder engine) -- what's unverified is
  specifically the platform-specific packaging step (NSIS installer generation, macOS code
  signing skip), not the app's own behavior once packaged. **To actually produce the .exe/.dmg,
  run `npm run dist:win` / `npm run dist:mac` from `RestaurantOS-Desktop` on a real Windows
  machine / Mac** (exactly this Mac, once `npm install` is run there with real network access
  -- something this session's `device_bash` sandbox on this Mac has never had for any
  package, per every earlier verification entry in this file).

### Android POS terminal -- thin client, sideload only, no Play Store
Per explicit instruction: not a native iOS/Android app-store submission. A real Capacitor
Android project (`RestaurantOS-Android/`) was generated (`npx cap add android` -- a genuine
Gradle project, not hand-typed) as a **thin client**: the tablet runs no backend, database, or
Next.js server of its own -- it's a WebView shell (`www/index.html`) that connects over the
restaurant's own WiFi to the main POS computer, exactly like the existing customer-facing
display window already does, just as a separate Android device instead of a second monitor on
the same machine. This was an explicit architecture choice confirmed with you (thin client
over LAN, not a fully standalone per-device backend) rather than assumed.
`android:usesCleartextTraffic="true"` was added to the generated manifest since the LAN
connection is plain HTTP, matching every other local connection in this project.

- **The actual .apk could not be built in this sandbox, confirmed for real, not assumed**:
  `./gradlew tasks` (both the project's own wrapper, which tried to download Gradle itself
  from `services.gradle.org`, and the sandbox's preinstalled Gradle 8.14.3 directly) failed
  because Android's own build tooling (`com.android.tools.build:gradle`) has to be fetched
  from `dl.google.com` and Maven Central, and both returned `403 Forbidden` from this
  sandbox's network policy on every attempt. This is a sandbox network-allowlist limitation,
  not a project defect -- ordinary developer machines and CI runners reach both hosts fine.
- `RestaurantOS-Android/README-BUILD.md` documents the exact, free path to a real .apk:
  install Android Studio (which brings its own SDK), open this folder, `Build > Build APK(s)`
  or `./gradlew assembleRelease` from a terminal -- no Apple/Google developer account needed
  anywhere in that path, since this is never submitted to a store.

### What's NOT done / genuinely open
- Windows `.exe` and macOS `.dmg`/`.zip` binaries themselves do not yet exist anywhere --
  only the (verified-correct-by-equivalent-Linux-build) electron-builder config does. Run
  `npm run dist:win` / `npm run dist:mac` on a real Windows machine / this Mac to produce them.
- The Android `.apk` does not exist yet either -- the Gradle project is real and complete,
  but needs Android Studio (or a CI runner with unrestricted network) to actually compile it.
- Billing is still sandbox/mock-mode by design (per the original build plan) -- a platform
  admin can create real-looking plans and payment partners, and a subscription's `status`
  can be set to `active`, but nothing anywhere in this codebase calls a real payment
  provider's API to actually charge a card. Wiring a REAL payment provider (Stripe/Mollie/
  Adyen platform billing, as opposed to the in-restaurant terminal integrations already
  built) is a separate, larger task requiring real API credentials and a go-live decision.
- No UI yet for a tenant admin to see/change their OWN subscription (today only the platform
  admin can view/assign one, from `/admin`) -- not asked for, flagged as a likely next step
  once real billing is wired.

## 2026-09-12 — Real macOS run attempt: hard Gatekeeper/XProtect block, no override

Followed up on the "Windows/macOS binaries were NOT generated in this sandbox" gap from the
previous entry by actually building and running the app on the user's real Mac (not the
sandbox). Real, valuable findings, both fixed:

- `npm install` in `RestaurantOS-Desktop` needed its install scripts (`electron`'s binary
  download, `@serialport/bindings-cpp`'s native build) explicitly approved via
  `npm approve-scripts` + `npm rebuild` -- npm's newer script-allowlisting security feature,
  not a bug, but undocumented in the original instructions. Same happened in
  `RestaurantOS-Frontend` for `fsevents`/`unrs-resolver`.
- A `Docker-Backend-Test/backend` and `RestaurantOS-Frontend` `npm install` had accidentally
  been run once through the Cowork device-bridge sandbox (a separate Linux VM that shares the
  Mac's folder over a mount) rather than the user's real Mac terminal, which compiled
  `sqlite3`'s native binding for Linux instead of macOS (`dlopen ... slice is not valid
  mach-o file`). Fixed by having the user `rm -rf node_modules` and reinstall for real,
  natively, in their own Terminal. **Lesson for future sessions: never run `npm install` for
  a project with native (compiled) dependencies through the device-bridge shell when the
  target is the user's own machine -- it silently produces binaries for the wrong platform.**
- Electron's own official installer (`node_modules/electron/install.js`) silently failed to
  finish extracting its downloaded, verified-intact zip (`unzip -t` confirmed zero corruption)
  -- landed with an empty `Electron.app` and no `path.txt`. Root cause not fully isolated
  (Node v26.5.0 is very new; possibly an `extract-zip`/`@electron/get` incompatibility with
  it), but worked around by extracting the same cached zip manually with `ditto -xk` (Apple's
  own archive tool, which preserves code-signing metadata that plain `unzip` does not).

**The real, unresolved blocker**: even a properly built, uniquely-named `RestaurantOS.app`
(via the real `npm run dist:mac` -- which itself worked, producing real x64+arm64
`.dmg`/`.zip` files) was refused by macOS with "was not opened because it contains malware"
-- not the milder "unidentified developer" warning, and with NO override available anywhere
(no entry in System Settings -> Privacy & Security, confirmed by checking). Confirmed this
Mac is not MDM-managed (`profiles status -type enrollment` -- both No), so this is plain
macOS's own Gatekeeper/XProtect being stricter about ad-hoc-signed (non-notarized) apps on
this OS version than on older ones, not a code defect and not a corporate policy.

**Decision, made by the user, not guessed at**: skip further macOS dev-mode testing and
focus verification on the real Windows 11 POS machine instead (the actual production
target), rather than either (a) paying for an Apple Developer ID to sign+notarize purely to
unblock local testing, or (b) disabling Gatekeeper machine-wide as a workaround. This matches
the original instruction's own priority ("Windows primary... Mac only if easy, else skip").

### What this means for a real macOS release later
If macOS support is wanted for real distribution (not just this session's testing) in the
future, the only clean path is a real Apple Developer ID ($99/year) plus wiring
`electron-builder`'s notarization step (`identity` + `notarize` config, replacing today's
`identity: null`) -- flagged here rather than silently left as a mystery next time this comes
up.
