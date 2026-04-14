# ADR-010: Transaction Boundaries via withTx and withOrgTx
**Date:** 2026-04-13
**Status:** ACCEPTED
**Domain:** architecture, data-access, multi-tenancy

## Context
With vertical domain layout (ADR-009), services operate on `Repos` bound to a `DbExecutor`. Cross-cutting flows that must be atomic (e.g., creating an org and its first user together) need a way to run multiple domain services inside a single transaction. Simultaneously, every tenant-scoped query must set `app.current_org_id` for RLS (ADR-002), and this must not be forgotten or misapplied. The previous implementation used a pool-based `withOrgContext` wrapper in Express middleware that had a race condition (connection released before response was sent) and a `SET`/`RESET` pattern that was not transaction-safe.

## Decision
All transaction management goes through two functions in `src/db/tx.ts`:
- `withTx(fn)` — opens a transaction, builds a `Repos` bundle over it, runs `fn(repos)`. For flows that have no org id yet (bootstrap).
- `withOrgTx(orgId, fn)` — opens a transaction, runs `SET LOCAL app.current_org_id = $orgId`, builds `Repos`, runs `fn(repos)`. Default for all tenant-scoped work.

Services never call `db.transaction()` directly. Route handlers call `withOrgTx` themselves; middleware only validates and attaches `req.orgId`.

## Alternatives Considered
| Option | Reason Rejected |
|--------|----------------|
| Middleware-owned transaction wrapping all routes | Express `next()` is synchronous; the connection releases before async route handlers complete — a real race condition present in the prior implementation |
| Services accept optional `trx` parameter | Callers must thread `trx` through every call; DI-by-parameter at every layer is the problem we're solving |
| Single `withTx({ orgId? })` | No compile-time distinction between "intentionally unscoped" (bootstrap) and "forgot the orgId"; two named functions make this explicit |

## Consequences

### Positive
- `SET LOCAL` scopes `app.current_org_id` to the transaction — auto-cleared on commit or rollback, no manual `RESET` needed
- Cross-cutting services compose domain services inside `withTx`/`withOrgTx`; all writes are atomic within that transaction
- Route handlers own their own transaction scope; no middleware-connection race condition
- Two clearly named functions make the intent explicit at each callsite

### Negative / Trade-offs
- Services cannot open their own transactions; all transaction boundaries are at the service-composition layer
- A service method that needs a transaction for internal consistency (e.g., two writes in one service) cannot self-contain it — it relies on the caller providing a transactional `Repos`

### Risks
- RISK: Bootstrap (`withTx`, no RLS) fails silently in production if the Postgres role respects RLS | MITIGATION: Bootstrap is a CLI-only flow that must be run with the migration/superuser role; this is documented and not a runtime API path. See "review trigger" below.

## Compliance
- MUST: All tenant-scoped queries MUST go through `withOrgTx`
- MUST: Bootstrap and other flows that create the org itself MUST use `withTx`
- MUST: `app.current_org_id` MUST be set with `SET LOCAL` (transaction-scoped), never `SET` (session-scoped)
- MUST NOT: Services call `getDb().transaction()` directly
- MUST NOT: Middleware wrap route handlers in a shared transaction; each handler opens its own `withOrgTx` scope
- SHOULD: Cross-cutting services that need atomicity across domains use `withTx`/`withOrgTx` internally, not expose a `repos` parameter to callers

## Review Trigger
A separate "app role" (non-superuser, respects RLS) is introduced for production, at which point the bootstrap `withTx` path needs to explicitly use `BYPASSRLS` or a privileged role rather than relying on the migration role.

## Related
- SUPERSEDES: NONE
- RELATED TO: ADR-002, ADR-009
- REFERENCED BY: NONE
