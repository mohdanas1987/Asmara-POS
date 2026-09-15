# RestaurantOS Frontend

New Next.js (App Router, TypeScript, Tailwind) frontend for the RestaurantOS SaaS rebuild.
Talks to the existing Phase 1 backend (the same one in `../Docker-Backend-Test`) over its
existing `asmara-token` JWT header — no backend changes needed for this to work. Never
contacts `srv1399.hstgr.io`.

## Run it

1. Start the Phase 1 backend first (separate terminal):
   ```
   cd ~/Desktop/Dev-Projects/Asmara-POS/Docker-Backend-Test
   docker compose up --build
   ```
2. In this folder:
   ```
   cd ~/Desktop/Dev-Projects/Asmara-POS/RestaurantOS-Frontend
   npm install
   npm run dev
   ```
3. Open http://localhost:3000 — click "Sign in", log in with the seeded test admin
   (`admin@test.local` / `Test1234!`), and you'll land on the (placeholder, for now) POS page.

`npm install` needs to run from your own Terminal — I can't run it myself from here, since this
session's connection to your Mac has narrower network access than your own Terminal does.

## What's here so far

- Project scaffold (Next.js + TypeScript + Tailwind), design tokens (`tailwind.config.ts`),
  a small shared `Button` component to start the design system.
- Working login page wired to the real `/auth/login` route (dev-proxied to `localhost:5102`,
  see `next.config.mjs`).
- Placeholder POS page — the real product grid/cart/payment flow is being built next.

## Status

This is an early, in-progress scaffold, not the finished product — see
`../phases/RESTAURANTOS-SAAS-BUILD-PLAN.md` for the full build plan and phase breakdown.
