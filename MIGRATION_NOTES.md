# Kysely → Prisma Migration Notes

This document records every decision, tradeoff, and behavior note from migrating
the persistence layer from Kysely + node-pg-migrate to Prisma 7 + Prisma Migrate.
It is written to be read alongside the PR: each commit in the sequence maps to a
section here. Sections marked _(pending)_ are filled in as the corresponding
commit lands.

## 1. Why and scope

Replace Kysely with Prisma ORM as the database access layer and node-pg-migrate
with Prisma Migrate. Behavior stays identical: no schema changes, no query
optimization, no frontend changes. The public surface of every persistence
service (exported input/result type names, service method signatures, error
types) is frozen — only internals of `packages/backend/libs/{db,accounts,sync,queue,adapters}`
and the `repel db` CLI change.

Ground truth for "no schema changes" is a `pg_dump --schema-only` of a fully
migrated database captured before the port began; the same dump after the port
must differ only in the migrations-tracking table (`pgmigrations` →
`_prisma_migrations`).

## 2. Stack choices _(pending)_

- Prisma 7.x, Rust-free client.
- `prisma-client` generator (not `prisma-client-js`): emits TypeScript into the
  source tree, which fits this repo's ADR-015 exports-map convention the same
  way the committed `kysely-codegen` output did.
- `@prisma/adapter-pg` driver adapter over the `pg` driver.
- Prisma CLI runs under Node (see §8).

## 3. Transactions and RLS _(pending)_

- `runInOrgTx` / `runInTx` decorators keep their exact public shape and
  AsyncLocalStorage join/guard semantics.
- `SET LOCAL app.current_org_id = <literal>` becomes
  `SELECT set_config('app.current_org_id', $1, true)` — the parameterizable
  equivalent, identical transaction-scoped GUC semantics.
- Interactive `$transaction` timeout: previously unbounded under Kysely, now
  bounded. The one deliberate behavioral delta; value recorded here once set.
- Error normalization matrix (Prisma known-request errors, raw-SQL pg errors,
  AppError passthrough).

## 4. Schema modeling _(pending)_

- camelCase fields ↔ snake_case columns via `@map` / `@@map` (replaces
  Kysely's `CamelCasePlugin` for the query API; raw SQL aliases explicitly).
- Native type mappings (uuid, timestamptz, bytea, text[], jsonb, int8, enums).
- DDL Prisma Schema Language cannot express — row-level security policies,
  partial indexes, CHECK constraints — and where it lives instead.
- Observed `prisma migrate dev` differ behavior against hand-added DDL.

## 5. Migration history _(pending)_

- Baseline strategy: one `0_init` migration diffed from the schema plus
  hand-appended RLS/partial-index/CHECK DDL, instead of porting the six
  historical node-pg-migrate files. Rationale and tradeoffs.
- Paths for existing dev databases.
- No down migrations under Prisma Migrate; what replaces `repel db migrations down`.

## 6. Raw SQL strategy _(pending)_

- Which queries stay raw and why (`FOR UPDATE SKIP LOCKED`, partial-index
  `ON CONFLICT`, writeable CTEs, `DISTINCT ON` + `LATERAL`).
- TypedSQL evaluated and rejected; rationale.
- The `Prisma.sql` builder pattern and the in-SQL camelCase aliasing rule.

## 7. Behavior parity notes _(pending)_

- bytea: `Buffer` → `Uint8Array` and the seam that preserves `Buffer` for
  callers.
- int8 select type: `string` (pg) vs `BigInt` (Prisma).
- Json null handling, undefined-key insert semantics, "no result" error types.

## 8. Bun × Node frictions _(pending)_

- Why the Prisma CLI runs under Node and how the `repel` CLI shells out to it.
- Install-time behavior (postinstall scripts, trusted dependencies) under Bun.

## 9. Testing _(pending)_

- The compile-only SQL-shape test pattern and its Prisma equivalent
  (`Prisma.Sql` builders compile without a connection).
- Which tests were deleted because the type system now subsumes them.
- No database test harness — unchanged, deliberate.

## 10. Tooling deltas _(pending)_

- `repel db` command-by-command before/after.
- Codegen no longer requires a live database.
- Shadow-database requirement for creating migrations.

## 11. Commit map _(pending)_

One entry per commit once the sequence is final.

## 12. Verified-during-implementation log _(pending)_

Resolutions of Prisma 7 specifics that were uncertain at planning time
(generator output shape, adapter constructor, error metadata for raw queries,
differ behavior, transaction defaults, parameter serialization).
