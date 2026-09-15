# DISASTER-RECOVERY-STANDARD.md
**Governance item:** §1.F, Master Development Specification v2.0
**Status:** DRAFT — numeric targets below are proposed starting points for owner/CTO review, not yet confirmed operational commitments. Formal adoption happens at Stage 11/phase 80; referenced from Stage 0 onward for anything already backed up.

## Backup frequency & retention, by data class

| Data class | Proposed frequency | Proposed retention | Status |
|---|---|---|---|
| Production database (MySQL) | Daily full + continuous binlog/point-in-time if the host supports it | 30 days rolling, plus one monthly snapshot kept for 12 months | **PROPOSED** — depends on what Hostinger's plan actually offers; needs confirming against the real hosting account |
| Application build/source/config | On every Release Bundle (§1.D) promotion to Production | Indefinite (version-controlled) | **PROPOSED** |
| Local terminal data (offline DB, tmp/reports, tmp/products) | Daily, or on every sync-engine checkpoint once Stage 7 ships | 90 days | **PROPOSED** |
| Media/images | Weekly, or continuously once object storage (Stage 19 territory) replaces local files | 12 months | **PROPOSED** |

## Restore drill cadence

**PROPOSED:** quarterly, at minimum — restore the latest backup of each data class above into an isolated environment and confirm it's usable, not just "present." The first drill happens in Stage 0/phase 2; this cadence takes over from there.

## RPO / RTO

- **RPO (Recovery Point Objective) — PROPOSED: 24 hours** for the database (i.e., in the worst case, at most one day of orders/transactions could be lost). Tightens automatically once Stage 7's offline-first sync engine and durable outbox ship, since those make more frequent, transaction-level recovery possible.
- **RTO (Recovery Time Objective) — PROPOSED: 4 hours** during service hours for a full database restore; **PROPOSED: 30 minutes** for an application-level rollback (reverting to the previous Release Bundle), since that's a much smaller operation.

These numbers are starting proposals for the business owner and CTO to confirm or revise — they are not yet commitments a restaurant should be told to rely on.

## Named scenario response plans

### Database corruption
Detect via the health checks introduced in Stage 11/phase 78. Response: stop writes, assess corruption scope, restore from the most recent verified backup per the RPO above, replay any recoverable transactions from the local terminal outbox (once Stage 7 exists) to minimize actual data loss below the RPO ceiling.

### POS terminal hardware failure / replacement
Because the terminal currently holds meaningful local state (offline SQLite, local media), replacement today means restoring that state onto new hardware from the most recent local backup. Once Stage 7's sync engine exists, this scenario simplifies considerably: a replacement terminal re-registers its terminal identity (phase 56) and pulls current state from the cloud rather than needing a local restore at all.

### Cloud / hosting outage
If the remote MySQL host (or its provider, Hostinger) has an outage, the POS's current architecture has no offline fallback beyond the unproven SQLite-switch mechanism (flagged since v1.0 of the Architecture Bible). Until Stage 7 ships a real offline-first foundation, this scenario's honest answer is: **the restaurant cannot take orders during a prolonged hosting outage today.** This is exactly the gap Stage 7 exists to close — it is listed here as a known, currently-unmitigated risk, not something this document pretends is already solved.

### Ransomware / security incident
**Explicitly deferred**, per the CTO review, until Stage 5's authentication/authorization hardening is proven in production (Stage 12 certification). Planning this properly before the JWT-secret and credential-hardcoding issues are fixed would be planning around a system that's still trivially compromisable — the fix comes first, the incident-response plan comes after.

## Escalation

Any gap identified above that management wants addressed sooner than its scheduled stage should be raised explicitly as a priority change, not silently reordered.
