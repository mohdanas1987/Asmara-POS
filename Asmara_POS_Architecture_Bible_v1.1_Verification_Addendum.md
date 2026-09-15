# Asmara POS Architecture Bible — v1.1 Verification Addendum

**Supersedes:** parts of `Asmara_POS_Architecture_Bible_v1.0.md`
**Method:** v1.0 was built from package inspection. For v1.1 I extracted the actual `app.asar` from `Asmara-POS.zip` (Electron 34, app version 5.0.4) and read the real backend source line by line — `server.js`, `db.js`, `knexfile.js`, `redis.js`, every file in `routes/`, `models/Reservation.js` / `models/Report.js`, `main.js`, `package.json`, both `.env` files (keys only — values were not copied into this document), and the compiled frontend bundle (`client/build/static/js/*.js`) via targeted string search.
**Rule kept from v1.0:** everything below is labeled **CONFIRMED FROM CODE**, **CORRECTION**, or **STILL UNPROVEN (needs runtime/production access)**. Nothing here is guessed.

This document does not replace v1.0's structure or its future-state sections (38–63) — those remain valid target-architecture thinking. It replaces v1.0's *confidence labels* wherever code now settles a question v1.0 had marked inferred or unproven, and it adds findings the package-level read missed.

---

## 1. The two most serious findings — now proven, not inferred

### 1.1 The JWT secret is a hardcoded literal string, identical in two files

`backend/routes/auth.js` and `backend/middlewares/loggedIn.js` both contain:

```js
const JWT_SECRET = 'whateverItWas';
```

It is not read from an environment variable. It is not per-install. It is compiled into every copy of the app anyone runs. Anyone who has ever received this executable can extract `app.asar` (a two-command, no-special-tools operation — `npm i @electron/asar && asar extract app.asar out`) and read this constant directly.

**Consequence:** authentication is not actually a secret-backed system. Anyone holding this string can mint a JWT for any user id (`jwt.sign({user:{id: <any id>}}, 'whateverItWas')`) and call every `fetchuser`-protected route as that user — including `/config/upload-db/:client` (see §1.2) and every order/payment/report endpoint. v1.0 listed "hard-coded JWT secret" as a suspected concern; it is now a **CONFIRMED, trivially exploitable P0**, independent of anything else on this list.

### 1.2 Production MySQL credentials are hardcoded in `backend/db.js`, separately from `.env`

```js
const mysqlConfig = {
  client: "mysql2",
  connection: {
    host: 'srv1399.hstgr.io',
    user: 'u272122742_res_asmara',
    database: 'u272122742_res_asmara',
    password: '<redacted — present in plaintext in db.js>',
    port: 3306
  },
  pool: { min: 2, max: 30 }
};
```

This is the config `server.js` actually loads (`require('./db')`). It is **not** the config in `knexfile.js`, which instead reads `REMOTE_SERVER_HOST` / `REMOTE_SERVER_USER` / `REMOTE_SERVER_PASSWORD` / `REMOTE_SERVER_DATABASE` from `.env`. Two independent, hand-maintained sources of DB credentials exist in the same package:

| File | Used by | Source of credentials |
|---|---|---|
| `backend/db.js` | the running app (`server.js`) | hardcoded literals in source |
| `backend/knexfile.js` | Knex CLI (migrations) | `.env` (`REMOTE_SERVER_*`) |

I did not compare the two credential sets' actual values (out of scope without live DB access), but the architectural risk is real either way: if they diverge, a migration run against `knexfile.js` config can silently target a different database than the one the live app writes to. If they match, the app is carrying the real production DB password as a plaintext string literal in source, shipped inside every install.

**This confirms and sharpens v1.0 §9/§10.** The pool `max: 30` v1.0 flagged as "oversized/ambiguous" is exactly what's in `db.js` — confirmed, not estimated. `knexfile.js`'s own `production` block additionally sets `max: 40` — a third, unused-at-runtime number, more evidence nobody is treating this file as authoritative.

**Recommendation for Phase 2:** rotate the DB password once a proxy/API layer replaces direct desktop→MySQL access (do not rotate blindly first — the running restaurant would go down); rotate the JWT secret immediately to an environment-injected, per-install random value (this alone can be done today with no schema or workflow change, and it is the single highest-value low-risk fix available).

### 1.3 A GitHub token is embedded in the root `.env`, shipped inside the package

Root `.env` (same file bundled into `app.asar`) contains a `GH_TOKEN` key. I did not print its value. `electron-updater`'s GitHub provider (v1.0 §43) is almost certainly what consumes it. Any token with more than public read-release scope, sitting inside a file every user's machine can extract, is a supply-chain risk: someone who extracts it could potentially publish a malicious release to whatever repo the token can write to, and the auto-updater would offer it to every Asmara POS install. **Needs verification of the token's actual scope (ideally read-only, fine-grained, repo-specific) as a Phase 2 action item** — this document deliberately doesn't check that, since it would mean using a live credential.

---

## 2. Authorization — the concrete gap list (v1.0 said "weak"; here is what "weak" means route by route)

v1.0 §13 concluded "several endpoints are protected only by authentication, while other state-changing endpoints do not consistently require authentication" — true, and now enumerable. Below, "auth" = the `fetchuser` middleware (itself weakened by §1.1 above).

**Entire route files with no auth middleware anywhere:**
- `backend/routes/tables.js` — **zero** routes use `fetchuser`. This includes `GET /tables/free-all`, which sets every table in the restaurant back to free with a single unauthenticated GET request, and `POST /tables/update-position/:table`.

**Individual state-changing routes with no auth, in files that otherwise do use it:**
- `orders.js`: `GET /cancel/:order/:table`, `GET /finish/:order/:table`, `POST /to-kitchen/:table?`, `GET /remove-report/:id` (deletes a stored report)
- `items.js`: `POST /updateStock/:id`, `GET /update-product-pos/:id/:status`, `POST /convert`
- `menu.js`: `GET /remove/:id` (deletes a menu category), `GET /toggle/:id/:status`, `GET /fill-color`
- `tax.js`: `GET /toggle/:id/:status`
- `config.js`: `GET /notification/delete/:id`, `GET /daily-reports/:status` (enables/disables the scheduled report job), `POST /daily-reports-time`

**State-changing operations expressed as GET** (v1.0 flagged this generically; here is the actual list — cancel order, finish order, remove menu category, remove report, toggle menu/tax status, toggle POS visibility, free all tables, split table, delete notification) — this matters beyond REST purity because GETs are what browsers, link previews, proxies, and crawlers will follow without any user action, and CORS is fully open (`app.use(cors())` in `server.js`, no origin allowlist — **CONFIRMED**, not inferred, closing v1.0 §44's open question).

Whether these routes are reachable from outside the terminal's own machine depends on what interface `server.js`'s `app.listen(5101)` binds to and the terminal's network exposure — **that part is still unproven without runtime/network access to the actual deployed machine.** But even if only reachable from `localhost`, the total lack of auth plus forgeable JWTs (§1.1) means anything that can reach port 5101 — malicious local software, a compromised browser tab if the machine ever browses the web, another device on the same LAN if the port isn't firewalled — has unrestricted operational and destructive control of the POS.

---

## 3. Corrections to specific v1.0 sections

### §5 / Customer Display window — CORRECTION
v1.0 stated the main renderer has `contextIsolation=true, nodeIntegration=false` and implied this as the general security baseline (§44 repeats it as a blanket positive). Checking `main.js` directly: that's true for the **main POS window**, but the **customer-display `BrowserWindow`** is created with:
```js
webPreferences: { nodeIntegration: true, contextIsolation: true }
```
`nodeIntegration: true` on any renderer is a real hardening gap even when it only ever loads a local URL (`http://localhost:5101/#/customer-screen`) — if that route were ever compromised (e.g., via a stored-XSS payload reflected from order/menu data into the customer-facing screen), the customer window would have direct Node.js access, unlike the main window. Low likelihood, non-trivial impact — worth a P2 fix (just remove the flag; nothing observed in the customer-screen route needs it).

### §37/§38 Redis and GraphQL — upgrade from "role unclear" to CONFIRMED DEAD IN THIS BUILD
v1.0 correctly noted GraphQL isn't mounted in `server.js` and called Redis's role "requires verification." Checked `backend/package.json`'s actual `dependencies` and the shipped `node_modules`: **neither `redis` nor `graphql` is an installed dependency in this package.** `backend/redis.js` does `require("redis")` and `backend/graphql/*.js` presumably requires a GraphQL library — both would throw `MODULE_NOT_FOUND` if that code path ever executed. Since `server.js` never calls into either file, the app runs fine, but this settles the question: **Redis and GraphQL are not merely unmounted, they are non-functional in the shipped build — dead code, safe to delete outright in Phase 2** rather than something needing a runtime check first.

### §49 Pusher — no correction needed, but adds detail
Confirmed no `pusher`-related package in backend `dependencies` either. Combined with the Redis/GraphQL finding, all three of the "maybe-active" real-time/caching layers v1.0 flagged are consistently absent from the actual dependency tree. Whatever real-time behavior the frontend bundle references, it has no live backend counterpart in this package.

### §27 Reservation model — CONFIRMED exactly as v1.0 suspected, plus new detail
`backend/models/Reservation.js`'s full contents:
```js
class Report extends Model {
  static get tableName() { return 'reports'; }
  static get relationMappings() {
    const Table = require('./Table');
    return { table: { relation: Model.BelongsToOneRelation, modelClass: Table,
      join: { from: "table_id", to: "" } } }; // <- empty "to", invalid mapping
  }
}
module.exports = Report;
```
This is byte-for-byte the same class as `backend/models/Report.js` (which correctly maps to `reports`), just copy-pasted under the `Reservation.js` filename with a broken relation added. And it's actually wired into a route: `backend/routes/tables.js`'s `GET /tables/reservations` runs `Reservation.query().select('*')` — **which queries the `reports` table and returns X/Z report rows relabeled as "reservations."** There is no reservations table, no reservation persistence, and no backend code path that could receive a booking from the website even in principle. **v1.0's "not yet proven" for website→POS reservation flow should be strengthened: it's not just unproven, it's structurally impossible in the current backend** — there's nowhere for a reservation to land. Table `status` does include a `reserved` state (seen in `routes/tables.js`'s className map), so *something* marks tables reserved, but it isn't this model or this route.

### §28–30 Website integration — CORRECTION: two separate external systems were conflated

v1.0 treated "website integration" and "external product synchronization" as one blurry relationship. The actual code shows **two distinct external hosts with two distinct purposes**, confirmed from different layers of the package:

1. **`asmara-eindhoven.nl`** (the restaurant's public website) — referenced **only in the compiled frontend bundle**, not in any backend route/model/util file. Confirmed frontend calls:
   - `REACT_APP_API = https://asmara-eindhoven.nl/api` (baked into the React build's env config)
   - `REACT_APP_IMAGE_URI = https://asmara-eindhoven.nl/storage`
   - a live call from the Electron renderer: `axios.post("https://asmara-eindhoven.nl/api/update-product-image", formData, ...)` — the POS frontend pushes a product image straight to the public website's API when an item image is changed, bypassing the embedded backend entirely.
   - the marketing/about text also just prints `www.asmara-eindhoven.nl` and `info@asmara-eindhoven.nl` as contact info (not an integration, just copy).

2. **`pos.dftech.in`** — a completely different domain, referenced **only in backend code** (`routes/items.js`, `routes/config.js`, `nisarga-utils.js`), never in the frontend bundle:
   - `POST https://pos.dftech.in/products/remove-product` (`routes/items.js`)
   - `POST https://pos.dftech.in/<path>` via a generic `queueProduct()` helper used for product create/update sync (`nisarga-utils.js`)
   - `GET /config/upload-db/:client` (`fetchuser`-protected, but see §1.1) uploads the **entire local `database/db.sqlite` file** to `https://pos.dftech.in/upload-db`, keyed by a `:client` path param, and records a `LAST_UPDATED` setting on success.

`dftech` reads as the POS software vendor's own name (this codebase's `nisarga-*` legacy files suggest "Nisarga"/"dftech" is the original product/vendor lineage before it was rebranded "Asmara POS" for this customer). **This means the actual production system already talks to a third external party that is neither Asmara's website nor Asmara's own infrastructure** — the vendor's own server receives product-sync calls and periodic full-database backup uploads. This is a materially different and more important finding than "website integration status unclear": it's a live vendor-operated data channel, and it should be first on the list for the "External integration inventory" that v1.0 §65 flagged as a required Phase-1 deliverable.

**Still unproven:** whether `pos.dftech.in` is a shared multi-tenant backend the vendor runs for all their POS customers (which would be directly relevant to the SaaS strategy — a competitor-of-sorts, or a partner, already exists), a single dedicated server for this client, or a dead/staging endpoint no longer live. Confirming this needs a live network capture or contacting the vendor, not more code reading.

### §40 Migration architecture — no correction, adds one concrete example
`backend/migrations/` does contain the `products`/`product_categories`/`products_categories` generation (matches v1.0), separate from the live `menu_items`/`menu_categories` models. Reconciling actual production schema against these migrations still requires DB access (unchanged from v1.0 — this is not resolvable from the package alone).

---

## 4. Updated Phase 1 Confidence Model (deltas only — see v1.0 §64 for the full baseline)

Moved from **"Not yet proven"** to **"Confirmed from code"**:
- Redis has no installed dependency in this build → dead, not merely unclear
- GraphQL has no installed dependency in this build → dead, not merely unclear
- Pusher has no backend dependency at all → confirmed frontend-only artifact
- The exact list of unauthenticated state-changing routes (§2 above)
- CORS is fully open (`cors()` with no config) — was inferred, now literal
- The Reservation model queries the `reports` table — reservations cannot persist in this backend at all
- `db.js` hardcodes production DB credentials as source literals (separate from `.env`)
- The JWT secret is a hardcoded literal, identical across two files
- A GitHub token is present in the shipped `.env` (value not inspected)
- The website (`asmara-eindhoven.nl`) and the vendor server (`pos.dftech.in`) are two separate integrations, not one blurry relationship
- The vendor server receives full local-database backup uploads, not just product sync

Still genuinely unproven — no amount of further static reading resolves these, they need production/runtime access:
- Whether `db.js`'s hardcoded credentials match, or diverge from, the `.env`-driven `knexfile.js` credentials
- The actual scope/validity of the `GH_TOKEN`
- Whether `pos.dftech.in` is vendor-shared multi-tenant infrastructure or dedicated to this client
- What network interface `server.js` actually binds to in the deployed environment, and whether port 5101 is reachable beyond the terminal itself
- Whether the website's own reservation form writes anywhere the POS can see (this addendum shows it structurally can't reach the POS backend directly — but the website's own server, which is out of scope of this package, might store it independently for staff to check by hand)
- Actual current production DB schema vs. migration history

---

## 5. Net effect on Phase 1 / readiness for Phase 2

Nothing here changes v1.0's strategic conclusion in §63–65 — if anything it reinforces "stabilize first, refactor second, replace only where justified." But it does change the **shape of Phase 2's first sprint**: the JWT-secret fix and the CORS/auth-middleware gaps on `tables.js` and the listed GET-based state changes are now proven, scoped, and — critically — fixable without touching the database, the schema, or any customer-visible workflow. They are the highest-value, lowest-risk P0/P1 items to land first, ahead of anything requiring production DB access or coordination with the `dftech` vendor.
