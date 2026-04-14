# ADR-009: Vertical Domain Layout with DbExecutor-Bound Repo Factories
**Date:** 2026-04-13
**Status:** ACCEPTED
**Domain:** architecture, data-access

## Context
The initial codebase used a horizontal slice layout (`repos/`, `services/`, `commands/`) where every domain was spread across four directories. This made ownership unclear, coupling between layers hard to see, and atomic cross-domain writes difficult to express. A vertical (domain-first) layout was adopted as part of the backend architecture refactor.

## Decision
Organize application code as vertical domain slices under `src/domains/<name>/`. Each domain owns its `repo.ts`, `service.ts`, `types.ts`, and `mappers.ts`. Repos are factory functions bound to a `DbExecutor` (`Kysely<DB> | Transaction<DB>`), not a fixed DB instance. Cross-cutting flows live in their own domain (e.g., `account-setup`) that depends on leaf domains but is not depended upon by them.

## Alternatives Considered
| Option | Reason Rejected |
|--------|----------------|
| Horizontal slices (`repos/`, `services/`) | Ownership unclear; every new domain requires files in four directories; DI of `db` through every layer is ceremony with no benefit |
| Class-based repositories with injected Kysely | Classes add constructor ceremony; static typing of `this` is awkward; no benefit over factory functions |
| Single service layer calling Kysely directly | Removes the repo abstraction; makes transaction composition impossible without duplicating query logic |

## Consequences

### Positive
- Domain ownership is immediately visible from the file path
- The same repo factory works inside or outside a transaction — no `TxRepo` variants needed
- Cross-cutting flows (`account-setup`) compose domain services without coupling domain repos to each other
- Testing a service requires only a fake `Repos` object, not a real database

### Negative / Trade-offs
- `db/repos.ts` must be updated when a new domain's repo is added
- `domains/` grows horizontally; domains with only one or two methods may feel over-structured
- Services cannot call `db.transaction()` directly — they must use `withTx` / `withOrgTx`

### Risks
- RISK: Cross-cutting flows accumulate in `account-setup` until it becomes a God domain | MITIGATION: Cross-cutting flows that span more than 2–3 domains should be split into their own domain; review at each new cross-cutting addition

## Compliance
- MUST: Repos MUST be factory functions accepting `DbExecutor` — `makeXRepo(q: DbExecutor)`
- MUST: Services MUST accept `Repos` as their dependency — `makeXService(repos: Repos)`
- MUST: Each domain MUST define its own types in `types.ts`; services MUST NOT return raw row types
- MUST: New domain repos MUST be wired into `db/repos.ts`
- MUST NOT: Services import raw Kysely or call `db.transaction()` directly
- MUST NOT: Leaf domains import from `account-setup` or other cross-cutting domains
- SHOULD: Mapper functions live in `mappers.ts` and convert row types to domain types at the service boundary

## Review Trigger
A domain grows large enough (> ~8 methods in repo or service) that splitting it into sub-domains would improve clarity.

## Related
- SUPERSEDES: NONE
- RELATED TO: ADR-010, ADR-011
- REFERENCED BY: NONE
