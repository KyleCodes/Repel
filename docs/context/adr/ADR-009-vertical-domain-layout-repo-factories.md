# ADR-009: Vertical Domain Layout with DbExecutor-Bound Repo Factories
**Date:** 2026-04-13 (amended 2026-04-14: `domains/` → `core/`; amended 2026-04-18: services are module-level singletons composed with runInOrgTx/runInTx decorators — see Amendments)
**Status:** ACCEPTED
**Domain:** architecture, data-access

## Context
The initial codebase used a horizontal slice layout (`repos/`, `services/`, `commands/`) where every domain was spread across four directories. This made ownership unclear, coupling between layers hard to see, and atomic cross-domain writes difficult to express. A vertical (domain-first) layout was adopted as part of the backend architecture refactor.

## Decision
Organize application code as vertical bounded-context slices under `src/core/<name>/`. Each context owns its `repo.ts`, `service.ts`, `types.ts`, and `mappers.ts`. Repos are factory functions bound to a `DbExecutor` (`Kysely<DB> | Transaction<DB>`), not a fixed DB instance. Cross-cutting flows live in their own context that depends on leaf contexts but is not depended upon by them.

## Alternatives Considered
| Option | Reason Rejected |
|--------|----------------|
| Horizontal slices (`repos/`, `services/`) | Ownership unclear; every new domain requires files in four directories; DI of `db` through every layer is ceremony with no benefit |
| Class-based repositories with injected Kysely | Classes add constructor ceremony; static typing of `this` is awkward; no benefit over factory functions |
| Single service layer calling Kysely directly | Removes the repo abstraction; makes transaction composition impossible without duplicating query logic |

## Consequences

### Positive
- Bounded-context ownership is immediately visible from the file path
- The same repo factory works inside or outside a transaction — no `TxRepo` variants needed
- Cross-cutting flows compose context services without coupling context repos to each other
- Testing a service is either (a) integration against a real DB, or (b) calling the undecorated `*Impl` function directly against a fake `Repos`. The decorated method requires a `TxContext` and cannot be called without one. See the 2026-04-18 amendment.

### Negative / Trade-offs
- `db/repos.ts` must be updated when a new context's repo is added
- `core/` grows horizontally; contexts with only one or two methods may feel over-structured
- Services cannot call `db.transaction()` directly — they must use `withTx` / `withOrgTx`

### Risks
- RISK: Cross-cutting flows accumulate in a single context until it becomes a God context | MITIGATION: Cross-cutting flows that span more than 2–3 contexts should be split into their own context; review at each new cross-cutting addition

## Compliance
- MUST: Repos MUST be factory functions accepting `DbExecutor` — `makeXRepo(q: DbExecutor)`
- MUST: Services MUST be exported as module-level singletons (`export const xService = { ... }`). Tenant-scoped methods MUST be wrapped in `runInOrgTx`. Unscoped methods (bootstrap-adjacent) MUST be wrapped in `runInTx`. Services MUST NOT accept `Repos` as a constructor parameter.
- MUST: Every tenant-scoped service method input MUST be a bare `orgId` string or an object with a required `orgId: string` field. Enforced at compile time by `OrgScoped<A>` on `runInOrgTx`.
- MUST: Each context MUST define its own types in `types.ts`; services MUST NOT return raw row types
- MUST: New context repos MUST be wired into `db/repos.ts`
- MUST NOT: Services import raw Kysely or call `db.transaction()` directly
- MUST NOT: Leaf contexts import from cross-cutting contexts
- SHOULD: Mapper functions live in `mappers.ts` and convert row types to domain types at the service boundary
- SHOULD: Services export a sibling `xServiceImpl` of undecorated functions (taking `Repos` directly) for cross-service composition inside `runInTx` flows, and for unit tests against fakes. Only lift named impls when actually needed — trivial methods stay inline in the `xService` object.

## Review Trigger
A context grows large enough (> ~8 methods in repo or service) that splitting it into sub-contexts would improve clarity.

## Amendments
- **2026-04-14:** Renamed the directory from `apps/server/src/domains/` to `apps/server/src/core/`. The term "domain" was overloaded in the codebase between (a) DDD bounded contexts (this ADR's meaning) and (b) API verticals (first-segment URL paths like `/messages`, `/contacts`). To eliminate the conflict, this ADR's concept is now called a "bounded context" and lives under `core/`. API verticals get their own home under `api/rest/routes/` and import from `core/`. The repo factory pattern, the `DbExecutor` binding, the `Repos` dependency injection, and all compliance rules are unchanged — only the directory name moves.
- **2026-04-18:** Services moved from factories (`makeXService(repos: Repos)`) to module-level singletons (`export const xService = { ... }`) whose methods are composed with the `runInOrgTx` / `runInTx` decorators from `db/tx.ts`. Transport layers (HTTP, GraphQL, CLI) no longer construct services per-request and no longer own the transaction boundary — they call service singletons directly. See the ADR-010 rewrite for the decorator model itself. This amendment only updates the service-layer contract to align with it. Cross-service composition inside `runInTx` (e.g. `account-setup.bootstrap`) uses the sibling `*Impl` export convention; leaf services whose methods only call through `repos` (the common case) use inline lambdas and do not export `*Impl`. The repo factory pattern, `DbExecutor` binding, and bounded-context layout from the 2026-04-13 decision are all unchanged. Validated end-to-end in `~/Developer/monorepo_template` before landing here; REP-9 carries the code migration in this repo.

## Related
- SUPERSEDES: NONE
- RELATED TO: ADR-010, ADR-011
- REFERENCED BY: NONE
