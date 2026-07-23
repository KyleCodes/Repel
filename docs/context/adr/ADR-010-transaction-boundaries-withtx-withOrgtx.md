# ADR-010: Transaction Ownership via `runInOrgTx` / `runInTx` Decorators

**Date:** 2026-04-13 (rewritten 2026-04-18 — shape changed from caller-owned `withOrgTx` to decorator-based service ownership; see History)
**Status:** ACCEPTED
**Domain:** architecture, data-access, multi-tenancy

## Context

With vertical feature layout (ADR-009), services compose flow and view runners that take a `Tx`. Every tenant-scoped query must set `app.current_org_id` for RLS (ADR-002), and this must not be forgotten or misapplied.

The original 2026-04-13 version of this ADR put transaction ownership at the **caller**: every HTTP/GraphQL/CLI handler imported `withOrgTx`, constructed the services it needed per-request (`makeUserService(repos)`), and managed the transaction boundary explicitly:

```ts
app.post('/api/todos', async (req, res) => {
  const todo = await withOrgTx(req.orgId, async (repos) => {
    const userService = makeUserService(repos);
    const todoService = makeTodoService(repos);
    // ...
  });
});
```

Two problems surfaced as the architecture matured:

1. **Leaky abstraction.** Transport layers (HTTP, GraphQL, CLI) knew transactions existed, imported tx primitives, and constructed services. The transport layer should not have to know that transactions exist.
2. **Composition friction.** `account-setup` held atomic multi-service flows by threading `withTx` into its factory. Leaf services had no way to compose atomically without either leaking `repos` upward through signatures or duplicating repo calls at the flow level.

The race condition in the pre-2026-04-13 `withOrgContext` middleware (connection released before async handlers completed) is still real — a transaction-scoped `SET LOCAL` is still the right mechanism. What changes is **who owns the transaction**: the service, not the caller.

## Decision

All transaction management goes through two decorators in `apps/server/src/infra/db/tx.ts`:

- `runInOrgTx(fn)` — tenant-scoped. Wraps a `(trx, input) => Promise<T>` function, returning a callable `(input) => Promise<T>` whose public input type is `A & { orgId: string }`. On call:
  - No ambient transaction active → opens one, runs `SET LOCAL app.current_org_id = <input.orgId>`, stashes `{ trx, orgId }` on an `AsyncLocalStorage` frame, and calls `fn(trx, input)`.
  - Ambient transaction with the same `orgId` → passes the ambient `trx` through (nested calls join the same tx automatically).
  - Ambient transaction with a different `orgId` → throws (cross-tenant leak guard).
  - Ambient unscoped transaction (`runInTx`) → throws; tenant-scoped code cannot run without RLS active.

- `runInTx(fn)` — unscoped. Same structure, no `SET LOCAL`, records `orgId: null` on the ALS frame. Used only for flows that create the org itself (bootstrap). Refuses to join an org-scoped ambient transaction (would silently bypass RLS).

`runInOrgTx` adds `orgId: string` to the wrapper's public input type; the inner flow/view never declares `orgId` itself — Postgres RLS scoped at `SET LOCAL` does the tenant filtering.

Transport layers (HTTP, GraphQL, CLI) **never import `runInOrgTx` or `runInTx`**. They call service singletons directly:

```ts
app.post('/api/todos', async (req, res) => {
  const body = CreateTodoBody.parse(req.body);
  const todo = await todoService.createTodo({ orgId: req.orgId, ...body });
  res.status(201).json(todo);
});
```

Services calling services is free — the nested call sees an ambient ALS frame and joins. All work commits or rolls back atomically.

Service methods that need to compose multiple flows or views inside one transaction (e.g. `accountsService.bootstrap`) wrap their operation in `runInTx` and call the underlying flow/view runners directly with the ambient `trx` from the closure. The runners are plain async functions (see ADR-009), so the service composes them naturally — no `*Impl` indirection.

## Alternatives Considered

| Option                                                                                     | Reason Rejected                                                                                                              |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Caller-owned `withOrgTx(orgId, (repos) => ...)` in every handler (the 2026-04-13 version)  | Forces transport layers to know about transactions, construct services per-request. Leaky and verbose.                       |
| `_inTx` dual surface per service (public methods own tx; `_inTx` methods take `trx`)       | Two APIs per service; callers must remember which to use.                                                                    |
| Thread `trx` through every service call signature (`todoSvc.create(trx, input)`)           | Leaks `trx` up to transport — the same leak, renamed.                                                                        |
| AsyncLocalStorage without a decorator (services call `runInOrgTx` inside each method body) | Method bodies gain a wrapper line each; the decorator collapses the boilerplate.                                             |
| Flatten services entirely; transport calls flows/views directly                            | Loses the service layer's role as the home for business rules; transport would have to know which decorator each flow needs. |
| Middleware-owned transaction wrapping all routes                                           | Express `next()` is synchronous; connection releases before async route handlers complete — real race condition.             |
| Services accept optional `trx` parameter                                                   | Callers must thread `trx` through every call; DI-by-parameter at every layer is the problem we're solving.                   |

## Consequences

### Positive

- Transport layers are ignorant of transactions. One rule: call services.
- **Parallel transport trees.** `apps/server/src/cli/` and `apps/server/src/api/` are peer transport trees. Both shapes (Commander namespaces under `cli/<ns>/handler.ts`, future Express routes under `api/<resource>/<route>.ts`) validate raw external input at the entrypoint and call `features/*/service.ts` singletons directly. Neither tree imports `features/*/flows/` or `infra/db/tx.ts` — the service decorator owns the transaction. See ADR-012 for the CLI tree shape.
- Services are stateless module singletons — no per-request construction.
- Cross-service composition is implicit and atomic. Nested decorated calls join the ambient tx via AsyncLocalStorage.
- One surface per service method. No dual API.
- `SET LOCAL` scopes `app.current_org_id` to the transaction — auto-cleared on commit or rollback.
- Cross-tenant writes and RLS-bypass mistakes are caught at runtime by explicit guards in the decorator.

### Negative / Trade-offs

| Risk                                                              | Mitigation                                                                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Wrong `orgId` supplied on nested call → silent cross-tenant write | `runInOrgTx` requires `orgId` in the public input type; runtime mismatch guard in decorator |
| Tenant service called inside bootstrap (`runInTx`)                | Decorator throws (`ambient.orgId === null` branch)                                          |
| Unscoped flow joining a tenant tx (would bypass RLS)              | `runInTx` throws if ambient has `orgId`                                                     |
| AsyncLocalStorage context loss on worker threads                  | N/A — service bodies never cross thread boundaries in this codebase                         |
| Mixing legacy `withTx`/`withOrgTx` with the new decorator         | Old exports removed from `infra/db/tx.ts` — one system only                                 |
| ALS overhead                                                      | ~100–200ns per `.run()` — negligible on request-path code                                   |
| Kysely/pg serialize queries on same connection inside a tx        | Correct transactional semantics; `Promise.all` inside a tx is safe but not parallel         |

### Risks

- RISK: Bootstrap (`runInTx`, no RLS) fails silently in production if the Postgres role respects RLS | MITIGATION: Bootstrap is a CLI-only flow run with the migration/superuser role. If a non-superuser app role is introduced, bootstrap must use a `BYPASSRLS` role explicitly.

## Compliance

- MUST: Tenant-scoped service methods MUST be wrapped in `runInOrgTx`.
- MUST: Bootstrap and flows that create the org itself MUST be wrapped in `runInTx`.
- MUST: `app.current_org_id` MUST be set with `SET LOCAL` inside the decorator (transaction-scoped), never `SET` (session-scoped).
- MUST: Every tenant-scoped service method input MUST be a bare `orgId` string or an object with a required `orgId: string` field.
- MUST NOT: Transport layers (HTTP, GraphQL, CLI) import `runInOrgTx` or `runInTx`.
- MUST NOT: Services be constructed via factory (`makeXService(...)`) or accept a `Tx` as a constructor parameter.
- MUST NOT: Any code call `getDb().transaction()` directly outside `infra/db/tx.ts`.
- MUST NOT: Middleware wrap route handlers in a shared transaction.
- SHOULD: Multi-step service operations wrap themselves in `runInTx` / `runInOrgTx` and call flow/view runners directly; the runners join the ambient transaction via ALS.

## Review Trigger

- A separate non-superuser app role is introduced in production, at which point the `runInTx` path needs to use `BYPASSRLS` or a privileged role explicitly.
- A legitimate cross-tenant admin flow appears (e.g. a super-admin dashboard). That case warrants a new `runAsAdmin` primitive rather than relaxing the cross-tenant guard.

## History

- **2026-07-23** — Prisma port (see `MIGRATION_NOTES.md`). The decorators are reimplemented over Prisma interactive transactions: `Tx` is now `Prisma.TransactionClient`, and `SET LOCAL app.current_org_id` became `SELECT set_config('app.current_org_id', $1, true)` — the parameterizable form with identical transaction-scoped GUC semantics. The ALS ambient-join mechanics and all guards are unchanged. One behavioral delta: transactions gain an explicit 30s timeout (Kysely's were unbounded; Prisma requires bounds).
- **2026-04-13** — Original decision: caller-owned `withTx(fn)` and `withOrgTx(orgId, fn)` functions in `db/tx.ts`. Services accepted `Repos` via `makeXService(repos)` factory. Route handlers opened `withOrgTx` themselves.
- **2026-04-18** — Rewrite: transaction ownership moved from caller to service via `runInOrgTx` / `runInTx` decorators. AsyncLocalStorage carries an ambient `TxContext = { repos, orgId | null }` so nested decorated calls automatically join instead of opening fresh transactions. Transport layers call service singletons directly and no longer import any tx primitive. Validated end-to-end in `~/Developer/monorepo_template` (see its ADR-009 for the sibling implementation); REP-9 carries the code migration in this repo. The `SET LOCAL`-inside-a-transaction mechanism from 2026-04-13 is retained unchanged — only the callsite that initiates the transaction changes.
- **2026-05-13** — Added the "Parallel transport trees" consequence to make the cli/api peer relationship explicit. No decision change; the codification was previously implicit. See ADR-012 for the CLI tree shape. REP-42 carries the addition.
- **2026-05-16** — REP-44. Decorator signature changed from `(repos, input)` to `(trx, input)`; the `Repos` bundle was removed entirely; the `OrgScoped<A>` helper was removed (the `orgId` constraint is now an intersection on the wrapper's public input type); flows and views are plain async runners (see ADR-009) that the service composes under one decorator. The `*Impl` sibling-export convention is gone — composition happens directly against the runners.

## Related

- SUPERSEDES: NONE (rewrite of self; history preserved above)
- RELATED TO: ADR-002, ADR-009
- REFERENCED BY: NONE
