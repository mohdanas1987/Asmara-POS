# RestaurantOS SaaS — Build Plan (Bible-format)

**Date:** 2026-09-11
**Scope:** Full multi-tenant restaurant POS SaaS — new frontend, tenant onboarding, billing, super-admin panel. Fully offline/local, zero contact with `srv1399.hstgr.io` (unchanged standing rule).
**Builds on:** Phase 1 (already complete, committed at device git HEAD `dcd5555`) — SQLite local dev environment, multi-tenant `tenant_id` schema/scoping across all 8 route files and 14 models, 26/26 backend tests passing, packaging pipeline fixed.
**Preserved:** The live Asmara restaurant's production system is never touched. Today's working Phase 1 deliverable is frozen at `Windows-Asmara-Check-First/` before any of this work began.

## Why a rebuild, not a patch

Task #12 established this as fact, not opinion: the current compiled frontend (`backend/client/build/`) has zero recoverable source and zero source maps — it is a dead end for further UI work. Every screen, tenant onboarding, and billing UI has to be built new. The existing backend (Express/Objection, already multi-tenant-scoped) stays as the API layer; this plan only replaces and extends what sits on top of it.

## Architecture

- **Frontend:** Next.js (App Router) + TypeScript + Tailwind CSS, new project `RestaurantOS-Frontend`, built API-first against the existing Express backend (no server-side coupling beyond HTTP/JWT — the backend keeps running standalone, exactly as Phase 1 left it).
- **Backend additions (Express, same codebase):**
  - Real `/auth/signup` tenant creation (closing the documented Phase 1 gap): creates a `tenants` row + first admin user in one transaction.
  - Subscription/billing tables and routes: `subscriptions`, `plans`, webhook-style status sync (sandbox/test-mode payment provider only, since this stays offline).
  - Super-admin routes: cross-tenant read access gated by a new `platform_admin` role, separate from normal tenant-scoped auth.
- **Design system:** one shared component library (buttons, inputs, modals, data tables, toasts) built once, reused across every screen — this is where "far better and easier to navigate than anything else on the market" actually gets won: consistent, fast, keyboard- and touch-friendly, no jQuery/Bootstrap-template weight like the old app carried.
- **Speed target:** POS screen interactions (add item, apply discount, take payment) must feel instant — optimistic UI updates against local state, background sync to the API, virtualized product grids for large menus.

## Phased task breakdown

1. **Scaffold** — Next.js project, Tailwind, design tokens, auth context wired to existing JWT (`asmara-token` header pattern preserved), protected route layout, dev proxy to the Phase 1 Docker backend on `localhost:5102`.
2. **Core POS screen** — product grid w/ category filters, cart/order builder, payment flow, receipt preview. Highest-traffic screen; built and hardened first.
3. **Remaining restaurant screens** (from Task #12's confirmed inventory): dashboard, floor/table layout (drag-positioned, matches existing `x`/`y`/`length`/`width` fields), order history/detail, menu & item management (incl. image upload), tax management, customer management, settings/config, reports (X/Z reports, reprint/delete), secondary customer-facing display window.
4. **Tenant onboarding** — signup wizard (restaurant name, first admin, initial table/menu setup), backend `/auth/signup` fix.
5. **Billing** — plan tiers (to be defined with the user before payment-provider wiring), sandbox-mode subscription gating so no real payment work happens while offline.
6. **Super-admin panel** — tenant list, usage/health at a glance, billing status, safe support tools (view-only by default).
7. **Test + verification** — automated tests for every new backend route (onboarding, billing, admin), key frontend flows, manual click-through of all screens, final phase report.

## Status update -- 2026-09-11: billing + native packaging done (see VERIFICATION.md)

Both remaining big pieces from the phased breakdown below are now built and verified:
- **Billing (step 5)**: resolved the plan-tiers/pricing decision below not by guessing at
  real prices, but by making plans, payment partners, and subscriptions fully dynamic --
  managed entirely by the platform admin from `/admin/billing`, with no hardcoded tiers
  anywhere in the code. Still sandbox/mock-mode only (no real payment provider is wired to
  actually charge a card) -- see VERIFICATION.md's "Billing groundwork" entry for the full
  detail, including a real bug the test suite caught and fixed (a deactivated plan could
  silently stay the signup default).
- **Native packaging (step 7's platform target)**: reworked per explicit instruction away
  from iOS/Android app-store submission. Windows (.exe, both an NSIS installer and a portable
  single-file exe -- the primary target, matching how the current live app already ships) and
  macOS (unsigned dmg/zip, no Apple developer account) via a real electron-builder config,
  fully verified end-to-end on Linux (the one platform the build sandbox can both build AND
  run) -- including three genuine, previously-invisible bugs in the desktop shell's own
  process-spawning code that only surfaced by actually launching the packaged app, not from
  reading the code. Android gets a real Capacitor-based thin-client project (sideload-only,
  never submitted to the Play Store) that connects to the main POS machine over WiFi rather
  than running its own backend. See VERIFICATION.md's native-packaging entry for exactly
  what was and wasn't possible to verify inside this project's build sandbox (Windows/macOS
  binaries and the Android .apk itself still need to be built on a real machine -- the sandbox
  cannot reach the hosts their toolchains download from).

## Explicitly deferred / needs the user's decision before proceeding

- **Real SaaS payment processing** (actually charging a restaurant's card for their RestaurantOS subscription) — still deferred; the platform admin can now define real-looking plans, prices, and payment partners, and mark a subscription "active", but no route anywhere calls a real payment provider's API. Wiring one for real needs real API credentials and a go-live decision. This is separate from the **in-restaurant payment terminal work**, which the user explicitly requested and which has now been built for four providers (Stripe Terminal, Adyen, SumUp, Mollie) — see the 2026-09-11 'Payment terminal support' entry in RestaurantOS-Frontend/VERIFICATION.md for what's real vs. still unproven there.
- **Real-time behavior** (the old app's undocumented Pusher integration, flagged in Task #12) — default plan: replace with a simple in-process WebSocket/event bus (removes an external paid dependency, and the old backend never even had the matching auth route). Will proceed on this default unless told otherwise.
- **Visual identity** — building with a clean, modern neutral design system by default (no theming request was given). Easy to re-skin later since it's one shared design-token file, not scattered per-screen styling.
- **Deployment/hosting** — explicitly out of scope per the user's own choice; this entire plan stays local/offline. Revisited only alongside Phase 2 (`srv1399.hstgr.io`), with separate explicit go-ahead.

## Non-negotiables carried forward from Phase 1 / standing project rules

- No contact with `srv1399.hstgr.io`.
- The live `asmara-eindhoven.nl` website is never touched.
- Nothing in `Windows-Asmara-Check-First/` (today's working snapshot) is modified.
- Every phase still gets a real Bible §26-format report, and nothing is claimed "done" without a passing automated test behind it.

## Addendum (2026-09-11) — Website sync, online orders, cross-platform

Two requirements added mid-build, now designed and built (see the frontend's VERIFICATION.md
for the full real-build/real-test record):

1. **Website <-> POS sync.** Searched the entire codebase first -- this did not exist
   anywhere before now (no webhook, no WooCommerce/Shopify/WordPress integration, nothing).
   Built as new: a pull-based menu feed (`GET /website/menu-feed`, API-key protected) the
   website reads from, and a push-based order webhook (`POST /website/orders`, API-key
   protected) the website posts new orders to. The POS never contacts the website in either
   direction, which is exactly why this could be fully built and tested offline without
   touching `srv1399.hstgr.io` or `asmara-eindhoven.nl`. A new Settings > Website Sync page
   handles connecting/disconnecting and walks through the setup steps. A new Online Orders
   page (gated off entirely until the website is connected) shows incoming online orders in
   real time via a built-in Socket.IO layer, clearly labeled apart from table/POS orders.
2. **Cross-platform.** The Next.js frontend already runs on Windows, macOS, and Linux via any
   browser, and on tablets the same way. Added a PWA manifest + service worker so it's also
   installable on Android, iOS, and desktop -- one responsive codebase. Native App Store /
   Play Store packaging (Capacitor) is a separate, larger task (developer accounts, signing,
   app review) and is tracked, not done.

## Discovered issue (not part of this feature, found while building it)
`routes/items.js`'s delete-item route silently calls an external third-party endpoint
(`https://pos.dftech.in/products/remove-product`) -- a leftover vendor integration. Delete-
item UI was deliberately not built in the new frontend until this gets a real decision.
