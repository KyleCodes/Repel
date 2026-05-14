# ADR-010: Transaction Ownership via `runInOrgTx` / `runInTx` Decorators

**Date:** 2026-04-13 (rewritten 2026-04-18 — shape changed from caller-owned `withOrgTx` to decorator-based service ownership; see History)
**Status:** ACCEPTED
**Domain:** architecture, data-access, multi-tenancy

## Context

With vertical bounded-context layout (ADR-009), services operate over `Repos` bound to a `DbExecutor`. Every tenant-scoped query must set `app.current_org_id` for RLS (ADR-002), and this must not be forgotten or misapplied.

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

All transaction management goes through two decorators in `apps/server/src/db/tx.ts`:

- `runInOrgTx(fn)` — tenant-scoped. Wraps a service method `(repos, input) => Promise<T>`, returning a callable `(input) => Promise<T>`. On call:
  - No ambient transaction active → opens one, runs `SET LOCAL app.current_org_id = <input.orgId>`, builds `Repos`, runs the inner function under an `AsyncLocalStorage` frame recording `{ repos, orgId }`.
  - Ambient transaction with the same `orgId` → reuses ambient `repos` (nested calls join the same tx automatically).
  - Ambient transaction with a different `orgId` → throws (cross-tenant leak guard).
  - Ambient unscoped transaction (`runInTx`) → throws; tenant-scoped code cannot run without RLS active.

- `runInTx(fn)` — unscoped. Same structure, no `SET LOCAL`, records `orgId: null` on the ALS frame. Used only for flows that create the org itself (bootstrap). Refuses to join an org-scoped ambient transaction (would silently bypass RLS).

Convention (enforced by `OrgScoped<A>` type on `runInOrgTx`, see ADR-009 amendment): every tenant-scoped service method input must be either a bare `orgId` string or an object with a required `orgId: string` field.

Transport layers (HTTP, GraphQL, CLI) **never import `runInOrgTx` or `runInTx`**. They call service singletons directly:

```ts
app.post('/api/todos', async (req, res) => {
  const body = CreateTodoBody.parse(req.body);
  const todo = await todoService.createTodo({ orgId: req.orgId, ...body });
  res.status(201).json(todo);
});
```

Services calling services is free — the nested call sees an ambient ALS frame and joins. All work commits or rolls back atomically.

Flow services that need multiple services inside one transaction (e.g. `account-setup.bootstrap`) wrap their method in `runInTx` and call the **undecorated `*Impl` functions** of downstream services with the ambient `repos`. Tenant-scoped decorated services cannot be called inside `runInTx` (RLS isn't active); the ADR-009 `*Impl` convention covers this case.

## Alternatives Considered

| Option                                                                                     | Reason Rejected                                                                                                  |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Caller-owned `withOrgTx(orgId, (repos) => ...)` in every handler (the 2026-04-13 version)  | Forces transport layers to know about transactions, construct services per-request. Leaky and verbose.           |
| `_inTx` dual surface per service (public methods own tx; `_inTx` methods take `repos`)     | Two APIs per service; callers must remember which to use.                                                        |
| Thread `repos` through every service call signature (`todoSvc.create(repos, input)`)       | Leaks `repos` up to transport — the same leak, renamed.                                                          |
| AsyncLocalStorage without a decorator (services call `runInOrgTx` inside each method body) | Method bodies gain a wrapper line each; the decorator collapses the boilerplate.                                 |
| Flatten services entirely; transport calls `repos` directly inside `withOrgTx`             | Loses the service layer's role as the home for invariants; transport-touches-repos violates the layering rule.   |
| Middleware-owned transaction wrapping all routes                                           | Express `next()` is synchronous; connection releases before async route handlers complete — real race condition. |
| Services accept optional `trx` parameter                                                   | Callers must thread `trx` through every call; DI-by-parameter at every layer is the problem we're solving.       |

## Consequences

### Positive

- Transport layers are ignorant of transactions. One rule: call services.
- **Parallel transport trees.** `apps/server/src/cli/` and `apps/server/src/api/` are peer transport trees. Both shapes (Commander namespaces under `cli/<ns>/handler.ts`, future Express routes under `api/<resource>/<route>.ts`) validate raw external input at the entrypoint and call `core/` service singletons directly. Neither tree imports `core/*/repo.ts` or `db/tx.ts` — the service decorator owns the transaction. See ADR-012 for the CLI tree shape.
- Services are stateless module singletons — no per-request construction.
- Cross-service composition is implicit and atomic. Nested decorated calls join the ambient tx via AsyncLocalStorage.
- One surface per service method. No dual API.
- `SET LOCAL` scopes `app.current_org_id` to the transaction — auto-cleared on commit or rollback.
- Cross-tenant writes and RLS-bypass mistakes are caught at runtime by explicit guards in the decorator.

### Negative / Trade-offs

| Risk                                                              | Mitigation                                                                          |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Wrong `orgId` supplied on nested call → silent cross-tenant write | `OrgScoped<A>` type constraint at compile time; runtime mismatch guard in decorator |
| Tenant service called inside bootstrap (`runInTx`)                | Decorator throws (`ambient.orgId === null` branch)                                  |
| Unscoped flow joining a tenant tx (would bypass RLS)              | `runInTx` throws if ambient has `orgId`                                             |
| AsyncLocalStorage context loss on worker threads                  | N/A — service bodies never cross thread boundaries in this codebase                 |
| Mixing legacy `withTx`/`withOrgTx` with the new decorator         | Old exports removed from `db/tx.ts` — one system only                               |
| ALS overhead                                                      | ~100–200ns per `.run()` — negligible on request-path code                           |
| Kysely/pg serialize queries on same connection inside a tx        | Correct transactional semantics; `Promise.all` inside a tx is safe but not parallel |

### Risks

- RISK: Bootstrap (`runInTx`, no RLS) fails silently in production if the Postgres role respects RLS | MITIGATION: Bootstrap is a CLI-only flow run with the migration/superuser role. If a non-superuser app role is introduced, bootstrap must use a `BYPASSRLS` role explicitly.

## Compliance

- MUST: Tenant-scoped service methods MUST be wrapped in `runInOrgTx`.
- MUST: Bootstrap and flows that create the org itself MUST be wrapped in `runInTx`.
- MUST: `app.current_org_id` MUST be set with `SET LOCAL` inside the decorator (transaction-scoped), never `SET` (session-scoped).
- MUST: Every tenant-scoped service method input MUST be a bare `orgId` string or an object with a required `orgId: string` field.
- MUST NOT: Transport layers (HTTP, GraphQL, CLI) import `runInOrgTx` or `runInTx`.
- MUST NOT: Services be constructed via factory (`makeXService(...)`) or accept `Repos` as a constructor parameter.
- MUST NOT: Any code call `getDb().transaction()` directly outside `db/tx.ts`.
- MUST NOT: Middleware wrap route handlers in a shared transaction.
- SHOULD: Flow services (`account-setup`-style) use `runInTx` and compose via the undecorated `*Impl` functions of downstream services (see ADR-009).

## Review Trigger

- A separate non-superuser app role is introduced in production, at which point the `runInTx` path needs to use `BYPASSRLS` or a privileged role explicitly.
- A legitimate cross-tenant admin flow appears (e.g. a super-admin dashboard). That case warrants a new `runAsAdmin` primitive rather than relaxing the cross-tenant guard.

## History

- **2026-04-13** — Original decision: caller-owned `withTx(fn)` and `withOrgTx(orgId, fn)` functions in `db/tx.ts`. Services accepted `Repos` via `makeXService(repos)` factory. Route handlers opened `withOrgTx` themselves.
- **2026-04-18** — Rewrite: transaction ownership moved from caller to service via `runInOrgTx` / `runInTx` decorators. AsyncLocalStorage carries an ambient `TxContext = { repos, orgId | null }` so nested decorated calls automatically join instead of opening fresh transactions. Transport layers call service singletons directly and no longer import any tx primitive. Validated end-to-end in `~/Developer/monorepo_template` (see its ADR-009 for the sibling implementation); REP-9 carries the code migration in this repo. The `SET LOCAL`-inside-a-transaction mechanism from 2026-04-13 is retained unchanged — only the callsite that initiates the transaction changes.
- **2026-05-13** — Added the "Parallel transport trees" consequence to make the cli/api peer relationship explicit. No decision change; the codification was previously implicit. See ADR-012 for the CLI tree shape. REP-42 carries the addition.

## Related

- SUPERSEDES: NONE (rewrite of self; history preserved above)
- RELATED TO: ADR-002, ADR-009
- REFERENCED BY: NONE
