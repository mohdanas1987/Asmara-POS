# Task #12: Frontend Source Recovery vs. Rebuild — Assessment

**Phase:** Phase 1 (local/offline development environment, no srv1399.hstgr.io dependency)
**Scope of this document:** an honest assessment only. No rebuild work was started — see
Conclusion for why, and what a real rebuild would take.

## What was checked

- `Asmara-POS.zip` (the original extraction source for this whole project) and
  `Currently ready for prod.zip` (the Stage 2/2b delivery bundle) — both re-inspected for
  any leftover frontend source tree, `package.json` for a client app, or a `src/` folder.
- The git-tracked working copy (`extracted/backend/client/`) built up over this project.
- The compiled output itself, `backend/client/build/`, for source maps (`.map` files) or
  any other artifact that could reconstruct real source.

## What exists

`backend/client/build/` contains a **production, minified Create React App build** and
nothing else:

- `index.html`, `asset-manifest.json`, `manifest.json` — standard CRA output.
- `static/js/main.4484671b.js` (636 KB) plus 19 numbered lazy-loaded chunk files
  (`static/js/<id>.<hash>.chunk.js`), totaling **1.3 MB of minified JavaScript**.
- `static/css/main.f44f9199.css` plus per-chunk CSS.
- `static/media/` — fonts (a `boxicons` icon font), a handful of images.
- **Zero `.map` files anywhere.** Source maps were not shipped with this build (a common,
  deliberate production setting — `GENERATE_SOURCEMAP=false` in a CRA `.env`, or simply
  never generated).

No `src/`, no client-side `package.json`, no `node_modules` for a separate frontend project,
no `.babelrc`/`webpack.config`/CRA scaffold of any kind, in either zip or anywhere in this
project's git history.

## What reverse-engineering the compiled bundle can (and can't) tell us

Grepping the minified bundle for licensing headers and string literals — not decompiling
or attempting to reconstruct component source, just reading what a production build
necessarily still contains in plain text — surfaces real, useful facts:

- **Framework/libraries:** React 19 (`react-dom-client.production.js`), Redux Toolkit
  Query (`executeQuery`/`executeMutation`/`invalidateTags`/`resetApiState` are RTK Query's
  own internal action-type strings, not application code), Bootstrap 5.3.8, jQuery 3.7.1,
  `classnames`. Confirms this is a fairly conventional, if fairly heavy (jQuery *and*
  React *and* Bootstrap together), CRA-era single-page app.
- **Pusher (real-time), ~111 occurrences of the string "pusher" in the main bundle** — a
  genuine integration, not incidental. This was not previously documented anywhere in this
  project's architecture notes. The bundle also contains `/broadcasting/auth`,
  `/broadcasting/user-auth`, `/pusher/auth`, `/pusher/user-auth` — the conventional
  endpoint shapes an app exposes on **its own backend** to authenticate a user for a
  private Pusher channel. **None of these exist in the current backend** (routes/*.js was
  read in full for the multi-tenant work in Task #10 — there is no `/broadcasting` or
  `/pusher` route anywhere). This is a discovered gap: either Pusher auth is handled
  entirely client-side against public channels only (plausible, and not necessarily a
  problem), or this is dead/vestigial code from a template the frontend was built on top
  of, or it's a real feature that quietly doesn't work. Not investigated further here —
  flagged for whoever picks up real-time behavior next, since it directly affects whether a
  rebuild needs to reproduce a live Pusher integration or can drop it.
- **Route/screen inventory**, from string literals that match this SPA's own client-side
  router paths: `/login`, `/dashboard`, `/pos/*`, `/orders`, `/orders/create`, `/tables`,
  `/tables/reservations`, `/floors`, `/menu`, `/items`, `/customers`, `/customer-screen`,
  `/config`, `/config/settings`, `/config/notifications`, `/reports`, `/add`, `/remove`.
  This lines up closely with the backend route files already fully reviewed in Tasks #9–10
  (auth, pos, orders, tables, menu, items, config, tax) — a useful cross-check that the
  backend's route surface and the frontend's screen inventory are consistent, and that
  there isn't a whole hidden feature area the backend doesn't support.

What this **cannot** do: recover actual component source. A minified production bundle has
had every variable and function renamed to single/double letters, JSX compiled to
`react.createElement`/`jsx()` calls with no trace of original file boundaries, comments
stripped, and dead code eliminated. Decompiling this into something resembling the
original `.jsx` files would produce code that *runs* (in principle) but bears no
resemblance to how it was actually written — no real component names, no real prop names,
no original file/folder structure, no comments explaining intent. Treating that output as
"recovered source" would be misleading: it would be a *reimplementation guess* wearing the
original's clothes, not a recovery.

## Conclusion

**True frontend source recovery is not possible from what exists in this project.** There
is no source, and there are no source maps to reconstruct it from. The only two honest
options are: (a) keep shipping the existing compiled build indefinitely, patching backend
behavior around it exactly as Stage 2/2b already did (GET-verb aliases kept alongside
correct-verb routes, the table-transfer feature built backend-only with no UI yet, etc.);
or (b) commission a genuine from-scratch rebuild.

This assessment does **not** attempt option (b) in this pass — doing so responsibly means
scoping it honestly first, which is what the rest of this document does.

## What a from-scratch rebuild would actually require

Based on the backend API surface (fully read across Tasks #9–11) and the screen/route
inventory recovered above, a faithful rebuild is a real, multi-week frontend engineering
project on its own, not something to estimate in hours or attempt inline here:

- **~13 distinct screens/areas** to design and build: login, a dashboard/landing screen, the
  POS/order-taking screen itself (almost certainly the most complex — product grid,
  category filters, cart/order building, payment flow, receipt printing), a floor-plan/table
  layout screen (drag-positioned tables, per Table.x/y/length/width — see
  `routes/tables.js`'s `/update-position` route), order history/detail views, a menu
  category + item management screen (with image upload/cropping, per `routes/items.js`),
  tax management, customer management, a settings/config area (stock alerts, notifications,
  daily-report scheduling), a reports screen (X/Z reports, report history/reprint/delete),
  and a secondary "customer-facing display" screen (`/customer-screen` — a second window,
  consistent with `main.js`'s second `BrowserWindow` reviewed during the Stage 2b security
  fix).
- **Real-time behavior** needs a product decision, not a guess: reproduce the existing
  Pusher integration (which would also mean actually wiring up the missing
  `/broadcasting/auth`-style backend route it currently seems to lack), replace it with
  something else (the app already has an Electron main process and a local Express server
  in the loop — a simple in-process event bus or WebSocket could well be simpler and remove
  an external paid dependency), or drop real-time updates entirely if they turn out to be
  unused/vestigial. This alone needs investigation this assessment didn't have scope for.
- **Printing, barcode, and hardware integration** — `preload.js` (read in full during the
  Stage 2b `nodeIntegration` fix) exposes `printContent`, `printReport`, `generateBarcode`,
  `getPrinters`, `drawCash` (cash drawer), and `loyaltyCard` over `contextBridge`. A rebuild
  has to reproduce every one of these integration points correctly — they're easy to miss
  since they only surface at the IPC boundary, not in any single screen's obvious UI.
- **Visual/UX parity** — matching the current look (Bootstrap 5 + custom styling, an admin
  template judging by the `data-menu-size`/`data-topbar-color`/`data-bs-theme` attributes on
  `<html>` in the shipped `index.html`, which are conventions from a commercial Bootstrap
  admin dashboard template) is either a deliberate goal (safest for the restaurant's staff,
  who already know this UI) or an opportunity to modernize — again a product decision, not
  an engineering one, and one that changes the estimate significantly either way.

None of this is a reason to avoid a rebuild eventually — it's the honest scope of what
"eventually" actually involves. The responsible next step, when this becomes a priority, is
a dedicated planning pass (its own FDD/TDD-style spec, per this project's existing Bible
process) with explicit answers to the real-time and visual-parity questions above, *before*
any frontend code gets written — not an attempt to reverse-engineer pixel-for-pixel
fidelity from a minified bundle.

## Recommendation for now

Leave `backend/client/build/` exactly as it is. Every backend change made in this project so
far (Stage 2, Stage 2b, and Phase 1's Tasks #9–11) was deliberately built to keep this exact
compiled frontend working unchanged — GET-verb legacy routes kept alive alongside
correctly-verbed replacements, the table-transfer feature built backend-only specifically
because there's no editable frontend to add a UI to yet, and multi-tenancy's JWT-based
`tenant_id` resolution requires no frontend change at all since it rides on the same
`asmara-token` header the frontend already sends. A frontend rebuild is a distinct, later
project, with its own dedicated plan — not something to fold into Phase 1's backend
hardening.
