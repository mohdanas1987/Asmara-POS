# backend/_quarantine/

STAGE 2 / phase 20 (Dead-code quarantine).

The four items below are moved here, unmodified, rather than deleted — per the Preservation
Contract, nothing is destroyed, only set aside with a documented reason. If any of this
turns out to be wrong (a code path I missed), restoring it is a one-line `git mv` back to
its original location.

## What's here and why

- **redis.js** — a Redis client wrapper. Redis is not installed anywhere in this deployment
  (confirmed: no `redis` server process, no `REDIS_URL`/`REDIS_HOST` env var referenced
  anywhere else in the codebase). Its only consumer is `graphql/resolvers.js`, below.

- **graphql/** (`resolvers.js`, `schema.js`) — a GraphQL schema/resolver pair. Nothing in
  `server.js`, `main.js`, or anywhere else mounts a GraphQL endpoint or requires this
  directory. `graphql` and `apollo-server`-style packages are not wired into the running
  Express app at all. This appears to be groundwork for a feature that was never finished
  or connected.

- **nisarga-server.js**, **nisarga-utils.js** — leftover files from the "Nisarga" code
  lineage this application evolved from. Despite the similarly-named `main-nisarga.js` at
  the project root, that file actually requires the modern `./backend/server` (confirmed by
  reading it directly) — it does NOT use these two files. Nothing anywhere in the codebase
  requires `nisarga-server.js` or `nisarga-utils.js`. They are dead code.

## Verification method

Before moving anything, I grepped the entire extracted application (excluding
`node_modules`) for every way these modules could be pulled in:

```
grep -rn "require(.*redis"   → only backend/graphql/resolvers.js  (itself quarantined)
grep -rn "require(.*graphql" → no hits outside graphql/ itself
grep -rln "nisarga-server\|nisarga-utils" → no hits anywhere
```

No route file, no `server.js`, no `main.js`/`main-nisarga.js`, and no `package.json` script
references any of these four items.

## If something breaks

If moving these causes an unexpected failure (which the verification above says it
shouldn't), the fix is:

```
git mv backend/_quarantine/redis.js backend/redis.js
git mv backend/_quarantine/graphql backend/graphql
git mv backend/_quarantine/nisarga-server.js backend/nisarga-server.js
git mv backend/_quarantine/nisarga-utils.js backend/nisarga-utils.js
```

This is a pure `git mv` — no content was changed, so restoring is lossless.
