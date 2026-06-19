# ADR-009: Vertical Feature Layout

**Date:** 2026-04-13 (amended 2026-04-14, 2026-04-18, 2026-05-13, 2026-05-16, 2026-06-19 — see Amendments)
**Status:** ACCEPTED
**Domain:** architecture, data-access

> **Path note (REP-63):** the REP-60 restructure moved this tree out of `apps/server/src/`. Features now live inside the `@repel/backend-features` package at `packages/backend/libs/features/src/accounts/…`. The vertical-slice decision below is unchanged; only the base path moved. Read `features/<feature>/` as `packages/backend/libs/features/src/<feature>/`.

## Context

The initial codebase used a horizontal slice layout (`repos/`, `services/`, `commands/`) where every domain was spread across four directories. Ownership was unclear, coupling between layers was hard to see, and atomic cross-domain writes were difficult to express. A vertical (capability-first) layout was adopted instead.

## Decision

Organize application code as vertical capability slices under `apps/server/src/features/<feature>/`. Each feature owns:

- `flows/<verb-noun>.ts` — one file per write use case. Plain `async (trx, input) => ...`. Owns a private Kysely query builder; result type is derived via `InferResult<ReturnType<typeof buildX>>[number]`.
- `views/<verb-noun>.ts` — one file per read use case. Same shape as a flow but read-only.
- `handlers/` — async entry points consumed by `processing-pipeline/`.
- `service.ts` — exactly one per feature. Imports flows and views, decorates each public operation with `runInTx` or `runInOrgTx` (see ADR-010), and owns feature-level business rules.
- `error.ts` — feature-local error hierarchy (an abstract base extending `AppError`, plus concrete subclasses thrown by service methods).

There is no per-feature `queries.ts` bundle, no `repo.ts`, no `mappers.ts`, no `types.ts` for domain entity shapes. Kysely's `DB` schema in `infra/db/types.ts` is the source of truth; every return type reaches the rest of the application through Kysely's type inference.

## Alternatives Considered

| Option                                                                                 | Reason Rejected                                                                                                                          |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Horizontal slices (`repos/`, `services/`)                                              | Ownership unclear; every new capability requires files in four directories; DI of `db` through every layer is ceremony with no benefit   |
| Per-feature query bundle (`makeFeatureQueries(trx)`)                                   | Bundle becomes a catalog the service must keep in sync with every flow; flows lose the property that each file declares its own contract |
| Repo factories bound to a `DbExecutor` (`makeXRepo(q: DbExecutor)`)                    | Inverted layering — `infra/db/tx.ts` had to know every feature's repo to assemble the bundle. Adding a feature required editing infra    |
| Hand-written domain types per feature (`Org`, `User` interfaces alongside Kysely rows) | Duplicate truth; types go stale when a query reshapes; the cost lands as a runtime mismatch caught months later                          |

## Consequences

### Positive

- Capability ownership is immediately visible from the file path.
- Each flow/view file is the smallest meaningful unit of database work — one query, one inferred type, one runner.
- "Rip out a feature cleanly" holds: deleting `features/<feature>/` leaves no dangling imports anywhere else in the tree.
- Type drift between SQL and TypeScript is impossible — Kysely is the single source of truth.
- Testing a flow or view is calling its plain async function with a fake `Tx`; no decorator, no `Repos`, no factory ceremony.

### Negative / Trade-offs

- Adding a new feature requires creating four or five files. The per-feature ceremony is mild but non-zero.
- Cross-feature read access goes through `views/`; cross-feature writes through `service.ts` (Rules 1b and 2 in the manifesto). This is deliberate but does mean a `views/` file may exist for an external consumer that does not yet exist.

### Risks

- RISK: A feature accretes more than one capability (becomes a god feature) | MITIGATION: Promote a sub-area to its own feature when it earns its own `service.ts` and `error.ts`. The unit test is in Appendix A of the architecture manifesto.

## Compliance

- MUST: Every feature lives under `apps/server/src/features/<feature>/` with the five-entry shape (`flows/`, `views/`, `handlers/`, `service.ts`, `error.ts`).
- MUST: Each flow and view is one file, exporting a plain `async (trx, input) => ...` function. No decorators in flow/view files.
- MUST: Each flow/view derives its result type from its Kysely query builder via inference (`InferResult<ReturnType<typeof buildX>>[number]`). No parallel domain-type layer.
- MUST: `service.ts` is the only place that applies `runInTx` / `runInOrgTx` (see ADR-010). Business rules (uniqueness checks, default roles, validation) live in the service.
- MUST: Service methods throw errors extending the feature's `error.ts` base (which extends `AppError` in `lib/error.ts`).
- MUST NOT: Per-feature `queries.ts`, `repo.ts`, `mappers.ts`, or `types.ts` for domain entity shapes. Kysely's `DB` schema in `infra/db/types.ts` is the source.
- MUST NOT: Flows or views open transactions, apply decorators, or invoke `getDb()` directly.
- SHOULD: A flow that grows past ~150 lines is promoted to `flows/<verb-noun>/` with step-files (`index.ts` + helpers split by operation step).

## Review Trigger

A feature directory's `flows/` or `views/` exceeds approximately eight entries — that is the signal to consider splitting the feature, per the manifesto's §11.

## Amendments

- **2026-04-14:** Renamed the directory from `apps/server/src/domains/` to `apps/server/src/core/` to eliminate the "domain" vs "API vertical" terminology clash.
- **2026-04-18:** Services moved from factories (`makeXService(repos: Repos)`) to module-level singletons (`export const xService = { ... }`) whose methods are composed with `runInOrgTx` / `runInTx` decorators from `db/tx.ts`. Transport layers stopped constructing services per-request. Cross-service composition inside `runInTx` used a sibling `*Impl` export convention.
- **2026-05-13:** Moved the `Repos` bundle from `db/repos.ts` to `core/repos.ts` to break a directory cycle between `db/` and `core/`. REP-42.
- **2026-05-16:** REP-44 — `core/` renamed to `features/`; the `Repos` bundle was deleted entirely; the per-feature `repo.ts`/`mappers.ts`/`types.ts` quartet collapsed into per-flow / per-view files that each own their Kysely query builder; the `*Impl` sibling export convention was dropped (service.ts composes flow/view runners directly); `error.ts` was added as the fifth per-feature entry. The Decision and Compliance sections above describe the current shape; this Amendments list is the journey.

## Related

- SUPERSEDES: NONE
- RELATED TO: ADR-010 (decorator-based transaction boundaries), ADR-011 (CamelCasePlugin)
- REFERENCED BY: NONE
