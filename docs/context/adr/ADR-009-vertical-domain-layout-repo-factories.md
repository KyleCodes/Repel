# ADR-009: Vertical Domain Layout with DbExecutor-Bound Repo Factories
**Date:** 2026-04-13 (amended 2026-04-14: directory renamed `domains/` → `core/`; see Amendments section)
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
- Testing a service requires only a fake `Repos` object, not a real database

### Negative / Trade-offs
- `db/repos.ts` must be updated when a new context's repo is added
- `core/` grows horizontally; contexts with only one or two methods may feel over-structured
- Services cannot call `db.transaction()` directly — they must use `withTx` / `withOrgTx`

### Risks
- RISK: Cross-cutting flows accumulate in a single context until it becomes a God context | MITIGATION: Cross-cutting flows that span more than 2–3 contexts should be split into their own context; review at each new cross-cutting addition

## Compliance
- MUST: Repos MUST be factory functions accepting `DbExecutor` — `makeXRepo(q: DbExecutor)`
- MUST: Services MUST accept `Repos` as their dependency — `makeXService(repos: Repos)`
- MUST: Each context MUST define its own types in `types.ts`; services MUST NOT return raw row types
- MUST: New context repos MUST be wired into `db/repos.ts`
- MUST NOT: Services import raw Kysely or call `db.transaction()` directly
- MUST NOT: Leaf contexts import from cross-cutting contexts
- SHOULD: Mapper functions live in `mappers.ts` and convert row types to domain types at the service boundary

## Review Trigger
A context grows large enough (> ~8 methods in repo or service) that splitting it into sub-contexts would improve clarity.

## Amendments
- **2026-04-14:** Renamed the directory from `apps/server/src/domains/` to `apps/server/src/core/`. The term "domain" was overloaded in the codebase between (a) DDD bounded contexts (this ADR's meaning) and (b) API verticals (first-segment URL paths like `/messages`, `/contacts`). To eliminate the conflict, this ADR's concept is now called a "bounded context" and lives under `core/`. API verticals get their own home under `api/rest/routes/` and import from `core/`. The repo factory pattern, the `DbExecutor` binding, the `Repos` dependency injection, and all compliance rules are unchanged — only the directory name moves.

## Related
- SUPERSEDES: NONE
- RELATED TO: ADR-010, ADR-011
- REFERENCED BY: NONE
