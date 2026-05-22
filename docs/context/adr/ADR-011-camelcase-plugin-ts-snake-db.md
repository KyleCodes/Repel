# ADR-011: CamelCasePlugin — TypeScript Uses camelCase, Database Stays snake_case

**Date:** 2026-04-13
**Status:** ACCEPTED
**Domain:** data-access, conventions

## Amendment — 2026-05-21 (Review Trigger fired)

The Review Trigger below — adoption of `kysely-codegen --camel-case` — has occurred (REP-45). `infra/db/generated.ts` is now produced by `kysely-codegen` from the live database schema, not hand-maintained. `runCodegen` (`apps/server/src/cli/db/lib/codegen.ts`) regenerates it and runs as a post-step of every migration command (`up`/`down`/`nuke`), so the generated types cannot drift from the schema; `repel db codegen` exposes it for manual runs. `infra/db/types.ts` retains only the hand-written `Db`/`Tx` aliases that re-export the generated `DB` interface.

The core decision is unchanged: TypeScript uses camelCase, the database stays snake_case, via `CamelCasePlugin`. What changed is that the camelCase `DB` interface is now generated rather than hand-written — so the "hand-maintained `types.ts`" statements in the original text below (Negative trade-off 1, the Risk, and the `SHOULD`) are superseded by codegen: adding a column means writing the SQL migration and running codegen, not editing `types.ts` by hand.

## Context

Kysely's query builder exposes column names to TypeScript exactly as they appear in the database — snake_case. TypeScript convention is camelCase for object properties. Manually mapping between the two at every callsite (or living with `user.org_id` in TS code) was error-prone and inconsistent with the rest of the codebase.

## Decision

Enable Kysely's `CamelCasePlugin` in `infra/db/client.ts`. All TypeScript code uses camelCase (`orgId`, `createdAt`, `isActive`). SQL column names and migration files remain snake_case. The `DB` interface in `infra/db/types.ts` uses camelCase keys; the plugin rewrites them to snake_case identifiers at SQL-generation time.

## Alternatives Considered

| Option                                                 | Reason Rejected                                                                                                                |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Keep snake_case in TypeScript                          | Inconsistent with TS convention; every object property access reads as SQL, not TS                                             |
| Manual mappers at the repo boundary without the plugin | Double the work: write camelCase types AND manual mapping every time; the plugin does this for free                            |
| kysely-codegen auto-generation                         | Codegen is the eventual goal but adds a build step; hand-maintained `types.ts` is simpler while the schema is evolving rapidly |

## Consequences

### Positive

- TS code reads as idiomatic TypeScript throughout
- No manual snake_case → camelCase mapping in repos
- Domain types and row types are consistent in casing

### Negative / Trade-offs

- The `DB` interface in `infra/db/types.ts` is hand-maintained in camelCase — adding a column requires updating both the SQL migration and `types.ts` with a camelCase key
- `app.current_org_id` (the Postgres session variable name) stays snake_case — it is not a column identifier and is not transformed by the plugin
- Table names in `DB` (e.g., `connected_account`, `job_queue`) stay snake_case — the plugin only rewrites column identifiers, not table names

### Risks

- RISK: A developer adds a column in snake_case to `types.ts` (forgetting the camelCase convention) — the plugin won't match it and queries will fail at runtime with a column not found error | MITIGATION: `tsc --noEmit` won't catch this; the convention must be documented. This ADR is that documentation.

## Compliance

- MUST: All column keys in `infra/db/types.ts` interfaces MUST be camelCase
- MUST: Table name keys in the `DB` interface MUST match the actual SQL table name (snake_case or reserved words as-is)
- MUST NOT: Use snake_case column keys in `infra/db/types.ts` interfaces
- MUST NOT: Manually map snake_case → camelCase in repo code — the plugin handles this
- SHOULD: When adding a column, add it snake_case in SQL, camelCase in `types.ts`, and verify with a type check run

## Review Trigger

The team adopts `kysely-codegen` with `--camel-case` output to auto-generate `types.ts`, at which point hand-maintenance is no longer required and this convention is enforced by tooling.

## Related

- SUPERSEDES: NONE
- RELATED TO: ADR-009
- REFERENCED BY: NONE
