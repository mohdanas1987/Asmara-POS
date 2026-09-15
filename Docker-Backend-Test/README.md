# Testing the Asmara POS backend on your Mac (Docker)

This runs the **backend only** — the real Express/Objection route code from Phase 1
(auth fixes, table-transfer, multi-tenant scoping, the whole hardened backend), wired to a
local SQLite database instead of the real production MySQL. It never contacts
`srv1399.hstgr.io` — there is no configuration for that host anywhere in this setup.

It does **not** run the Electron desktop app itself (see "Testing the actual desktop app"
below for why, and what that actually needs).

## One-time setup

1. Install [Docker Desktop for Mac](https://www.docker.com/products/docker-desktop/) if you
   don't have it already (works on both Apple Silicon and Intel Macs).
2. Open Terminal and go into this folder:
   ```
   cd ~/Desktop/Dev-Projects/Asmara-POS/Docker-Backend-Test
   ```

## Run it

```
docker compose up --build
```

First run builds the image (installs dependencies inside the container — this can take a
couple of minutes, mostly one dependency, `html-pdf`, downloading a headless-browser binary
it needs). Every run after that is fast.

You'll see migration + seed output, then:
```
Starting local dev server on http://localhost:5102 ...
```

Leave that terminal running. The API is now live at `http://localhost:5102`.

## Try it

In a second terminal:

```bash
# Log in as the seeded test admin
curl -s -X POST http://localhost:5102/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.local","password":"Test1234!"}'
```

Copy the `authToken` from the response, then:

```bash
TOKEN="paste-the-token-here"

curl -s http://localhost:5102/tables/ -H "asmara-token: $TOKEN"

curl -s -X POST http://localhost:5102/tables/transfer \
  -H "asmara-token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"from_table":"3","to_table":"1"}'
```

Or point a REST client (Postman, Insomnia, etc.) at `http://localhost:5102` the same way.

## Run the automated test suite inside the container

```
docker compose exec backend npm test
```

(26 tests — the same suite that's already part of the Phase 1 work.)

## Making changes and testing them

Edit any file under `Docker-Backend-Test/backend/` in your normal editor — it's a live
mirror of the real backend source, and the running container picks up changes automatically
(via `nodemon`) and restarts within a second or two. No rebuild needed for a plain code
change. You only need `docker compose up --build` again if you change
`backend/package.json` (i.e. add/remove a dependency).

**Important:** this `Docker-Backend-Test/backend/` folder is a **copy**, not the actual
device-side git working tree this whole project has been built in. It's meant for you to
poke at, try requests against, and see the real behavior — not as the source of truth for
what gets committed. If you make a change here that you want kept, tell me and I'll bring it
back into the real tracked source (and vice versa — ask me to refresh this folder any time
you want the latest committed backend copied in here again).

## Resetting the test database

```
docker compose down
rm backend/local_test.sqlite backend/.seeded
docker compose up --build
```

That wipes the SQLite file and the "already seeded" marker, so the next start reseeds fresh
test data (1 admin login, 3 tables, a sample order, etc. — see `backend/seeds_local/001_seed.js`).

## What this does NOT do

- **Does not run the Electron desktop app itself.** The actual POS app is a Windows desktop
  GUI application with native Windows binaries (bcrypt/sharp/sqlite3 compiled for win32) —
  Docker (on any OS, Windows containers included) has no display to show a GUI app on, so
  a container was never going to be the way to click through the actual POS screens. This
  setup is for exercising the API directly.
- **Does not touch the real database.** `srv1399.hstgr.io` is never contacted from here.

## Testing the actual desktop app (GUI) — your real options

Since Docker can't run a GUI app, testing the actual Electron POS windows needs a real
Windows environment. In order of how practical they are from a Mac:

1. **A Windows virtual machine on your Mac** — [Parallels Desktop](https://www.parallels.com/)
   or [VMware Fusion](https://www.vmware.com/products/fusion.html) (both support Apple
   Silicon Macs running Windows 11 ARM) or [UTM](https://mac.getutm.app/) (free, uses
   Apple's own virtualization framework). Once Windows is installed and running, the
   "Currently ready for prod" folder already delivered can be dropped in and run exactly as
   the README in that folder describes — genuinely the real app, running for real, just
   inside a VM window on your Mac instead of on separate hardware.
2. **A cloud Windows VM** (e.g. an Azure or AWS Windows instance, or a service like
   [Shadow](https://shadow.tech/) or [Amazon WorkSpaces](https://aws.amazon.com/workspaces/))
   — useful if you'd rather not install a full VM locally, at the cost of a subscription/
   hourly fee and needing decent internet for remote desktop responsiveness.
3. **The real POS machine itself**, once you're ready — ultimately the actual target, and
   the only environment that also proves the real Windows-native printer/barcode/cash-drawer
   integrations actually work, which nothing above can test.

If you'd like, I can help set up option 1 or 2 with you once you've picked one — just say
which.
