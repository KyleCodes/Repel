# Kysely → Prisma Migration Notes

This document records every decision, tradeoff, and behavior note from migrating
the persistence layer from Kysely + node-pg-migrate to Prisma 7 + Prisma Migrate.
It is written to be read alongside the PR; §11 maps the commit sequence.

## 1. Why and scope

Replace Kysely with Prisma ORM as the database access layer and node-pg-migrate
with Prisma Migrate. No schema changes, no query optimization, no frontend
changes. The public surface of every persistence service (exported input/result
type names, service method signatures, error types) is frozen — only internals
of `packages/backend/libs/{db,accounts,sync,queue,adapters}` and the `repel db`
CLI changed.

The parity contract: a `pg_dump --schema-only` of a database built by
`prisma migrate deploy` diffs clean against a dump of the node-pg-migrate-built
database, except the tracking-table swap (`pgmigrations` → `_prisma_migrations`).
Verified during the port (§12).

Mid-port the policy for query style was revised by review: the original plan
transplanted every statement verbatim (raw SQL wherever Kysely compiled
something Prisma's query API can't express); the final state uses **idiomatic
ORM operations everywhere the query API can express the work**, with raw SQL
confined to the queue and the migrations-tracking read (§6).

## 2. Stack choices

- **Prisma 7.9, Rust-free.** Driver adapters are mandatory in v7; no query
  engine binary, no postinstall downloads.
- **`prisma-client` generator** (not `prisma-client-js`): emits plain TypeScript
  into `libs/db/src/prisma/` — committed, like the kysely-codegen output before
  it, which fits ADR-015's "exports map of real source files" convention. The
  single entrypoint is `src/prisma/client.ts` (PrismaClient, the `Prisma`
  namespace, model types); `models.ts` barrels input types, `enums.ts` the
  enums. Runtime dependency is `@prisma/client` (generated code imports
  `@prisma/client/runtime/client`).
- **`@prisma/adapter-pg`** wrapping an explicitly constructed `pg.Pool`
  (`new PrismaPg(new Pool({connectionString}))`) so pool ownership stays
  visible and tunable.
- **v7 config layout:** the datasource `url` is banned from `schema.prisma`;
  it lives in `prisma.config.ts` (`datasource.url`), which also carries the
  optional `shadowDatabaseUrl`. v7 does not auto-load `.env` — the repel CLI
  injects `DATABASE_URL` into the child env, and the config throws at parse
  time on unset `env()` vars (hence the conditional shadow entry).

## 3. Transactions and RLS

- `runInOrgTx` / `runInTx` keep their exact public shape and AsyncLocalStorage
  join/guard semantics. The fresh-open path is an interactive
  `$transaction(async (trx) => ...)`; `Tx = Prisma.TransactionClient`.
- `SET LOCAL app.current_org_id = <lit>` became
  `SELECT set_config('app.current_org_id', $1, true)` — the parameterizable
  equivalent, identical transaction-scoped GUC semantics (and an improvement:
  no literal interpolation).
- **The one deliberate behavioral delta:** Kysely transactions were unbounded;
  Prisma requires bounds (defaults 2s/5s, far too tight for a sync batch).
  `TX_OPTIONS = { maxWait: 5s, timeout: 30s }` is the new ceiling.
- Error normalization: `normalizeDbError` additionally classifies
  `PrismaClientKnownRequestError`. The stored `code` is always the pg SQLSTATE
  (never a P-code), so SQLSTATE-matching callers are stable across the swap.
- RLS note: in dev the app connects as the `repel` superuser, which bypasses
  RLS entirely — true before and after the port (ADR-010 already carries this
  risk note). The `set_config` GUC was verified visible inside the transaction;
  actual policy enforcement requires the future non-superuser app role.

## 4. Schema modeling

- Hand-authored `schema.prisma`: camelCase fields with `@map`, snake_case
  tables with `@@map` — the replacement for Kysely's `CamelCasePlugin` on the
  query API. **Raw SQL aliases camelCase per-column in the statement itself**
  (`dedup_key AS "dedupKey"`); raw rows come back verbatim, nothing rewrites
  keys anymore.
- Field order mirrors live column order (attnum) so `CREATE TABLE` output
  diffs clean; constraint names pinned with `map:`; FK actions written
  explicitly (`onDelete/onUpdate: NoAction`, `Cascade` only where the DB has
  it) because Prisma's defaults (`Restrict`/`Cascade`) differ from the DB's
  plain `REFERENCES`.
- Native types: `uuid → String @db.Uuid`, `timestamptz → DateTime
@db.Timestamptz` (no `(6)` — precision would show in the dump diff),
  `bytea → Bytes`, `text[] → String[]`, `jsonb → Json @db.JsonB`,
  `int8 → BigInt`, PG enums → Prisma enums with `@@map`.
- `@default(now())`, **not** `@default(dbgenerated("now()"))`: Prisma
  introspects `now()` as its native default, so the `dbgenerated` spelling
  never compares equal and every `migrate dev` emits spurious
  `SET DEFAULT` ALTERs (found empirically via the differ check). `0_init`
  still writes `DEFAULT now()` so the dump matches the original.
- No `@updatedAt`: the old stack never auto-touched `updated_at` client-side;
  adding it would be a behavior change.
- **DDL PSL cannot express** lives as hand-appended SQL in `0_init`: RLS
  ENABLE + `tenant_isolation` policies (14 tables), the four partial indexes,
  and the four CHECK constraints. PSL v7 _can_ express partial indexes behind
  the `partialIndexes` preview flag, but three open Prisma bugs
  (prisma/prisma#29175/#29263/#29386) make the differ drop/recreate them
  perpetually — so they stay hand-written until that settles.
- Differ behavior, observed: objects invisible to PSL (policies, CHECKs,
  partial indexes) are ignored by `migrate dev` — a scratch-model migration
  contained only the scratch table, no `DROP INDEX`. The unique constraints
  Prisma generated as `CREATE UNIQUE INDEX` were hand-rewritten in `0_init` to
  `ADD CONSTRAINT ... UNIQUE` to match the live DB exactly.

## 5. Migration history

- **Baseline, don't port.** `0_init` = `prisma migrate diff --from-empty
--to-schema prisma/schema.prisma --script`, post-edited (unique constraints,
  hand-appended DDL sourced from the pg_dump of the fully migrated DB — not
  from the old TS builders, since the dump reflects the composed state after
  all six historical migrations). The six node-pg-migrate files are deleted;
  git history preserves them. Porting them would have meant transcribing
  `pgm.*` builder calls into SQL with high fidelity risk and zero payoff — no
  production DB exists and worktree DBs are rebuilt routinely.
- Existing dev DBs: default path `repel db nuke -y && repel db migrations up`;
  non-destructive path `prisma migrate resolve --applied 0_init` + drop
  `pgmigrations` (used on the primary dev DB during the port — status shows
  APPLIED, `up` is idempotent).
- **No down migrations** under Prisma Migrate. `repel db migrations down` is
  removed; nuke + up is the reset. The emergency escape hatch is
  `prisma migrate diff --from-schema ... --to-...` to synthesize a down script
  by diffing backwards — documented here, deliberately not wrapped in a
  command.
- `migrate dev` still requires a shadow database; the dev `repel` role can
  CREATEDB so Prisma provisions a throwaway one itself.

## 6. Where the ORM is used, and where raw SQL survives

Final policy (revised by review mid-port): ORM everywhere expressible.

**Query API:** all of accounts (creates, updates via `update` + P2025→undefined
mapping, findUnique/findFirst/findMany), bootstrap (nested org→user create),
sync's create-sync-job (one nested write: job → tasks → enqueued events),
persist-event (`Prisma.DbNull` for absent payloads), persist-message (upsert +
nested graph writes + `createMany` children), both sync list views, and
get-sync-task-results (ORM fetch + app-code fold replacing `DISTINCT ON` +
`LATERAL`; the fetch filters out high-volume `message` events so it scales
with task count, not mailbox size).

**Raw SQL (via `Prisma.sql` builders + `$queryRaw`/`$executeRaw`):**

| Statement                                    | Why the query API can't do it                           |
| -------------------------------------------- | ------------------------------------------------------- |
| queue `claim-jobs`                           | `FOR UPDATE SKIP LOCKED` dequeue                        |
| queue `enqueue-job`                          | `ON CONFLICT` targeting a _partial_ unique index        |
| queue `complete/dead-letter/reschedule/reap` | `SET col = now()` / interval arithmetic server-side     |
| db `migrations-tracking`                     | reads `_prisma_migrations`, which is not a schema model |

TypedSQL was evaluated and rejected: it centralizes SQL under `prisma/sql/`
(violating the one-file-per-use-case layout), requires a live DB at generate
time, and cannot express dynamic statements. `Prisma.sql` builders compile to
`{ sql, values }` with no connection, which is what keeps the SQL-shape tests
I/O-free (§9).

**The 25P02 lesson** (the most useful thing this port surfaced): the classic
ORM idempotency idiom — `create` then catch the unique-violation — does
**not** work inside an open Postgres transaction. The failed INSERT aborts the
transaction (`25P02 current transaction is aborted`); every subsequent
statement is refused, poisoning the ambient `runInOrgTx`. Postgres does not
take implicit savepoints. The in-transaction ORM idiom is **upsert** (compiled
to a native `ON CONFLICT`, which never errors); persist-message uses upsert
with an empty update and derives "did this insert?" from its 1:1 message row.

Manifesto note: the ORM port consciously trades Rule 3's "one mutation = one
statement" for query-API legibility. Atomicity is unchanged (every statement
shares the ambient interactive transaction); statement counts and lock windows
grew. The manifesto's rule text still describes the CTE style — amending it is
a follow-up decision, not smuggled into this PR.

## 7. Behavior parity notes

- **bytea:** Prisma returns `Uint8Array`, not `Buffer`. Every provider-account
  row leaves the accounts package through a seam that restores `Buffer` for
  `credentialsEncrypted` (the crypto lib's contract). Write inputs re-declare
  `Buffer` because TS 5.9 no longer treats `Buffer` as assignable to Prisma's
  `Uint8Array<ArrayBuffer>` input type (runtime-compatible; cast at the call).
- **int8:** `attachment.size_bytes` selects as `BigInt` (was `string` under
  pg/Kysely). No read path exists today; latent.
- **Json null:** the query API distinguishes SQL NULL (`Prisma.DbNull`) from
  JSON null — persist-event owns that mapping. Raw statements bind
  `JSON.stringify(...)::jsonb` (or SQL NULL) explicitly rather than relying on
  the adapter's parameter inference.
- **Nullable list columns:** Prisma list inputs can't be null; `message.references`
  (nullable `text[]`) is written by omission when null — column stays NULL,
  same as before. The adapter DTO re-declares the member as
  `string[] | null`.
- **Bootstrap dates:** the old `to_json()` CTE delivered ISO _strings_ at
  runtime while the types claimed `Date` (a known Kysely-helper caveat). The
  nested-create port returns real `Date` objects — the types are now truthful;
  JSON output is unchanged.
- **"No result":** Kysely's take-first-or-undefined on UPDATE..RETURNING maps
  to catching Prisma's P2025 (`isNoResultError`) and returning undefined —
  contract preserved.
- **Enum/scalar literals in raw SQL** are inline text (they were bound params
  under Kysely) with explicit casts (`::channel`, `::sync_event_type`) where
  the INSERT target can't drive inference.

## 8. Bun × Node frictions

- The Prisma CLI runs under **Node** (`execFileSync('node', [<db pkg>/node_modules/.bin/prisma, ...])`),
  never `bun x`: the CLI's Node shebang plus Bun's shim has a documented
  history of silent hangs (prisma/prisma#26560, #28805). Only the CLI — the
  generated client runs fine under Bun (all app processes still do).
- cwd is pinned to `packages/backend/libs/db` so `prisma.config.ts` and the
  schema resolve regardless of invocation directory (bun's isolated installs
  put the binary in that package's `node_modules/.bin`).
- Install-time: Rust-free v7 downloads no engines; nothing needs
  `trustedDependencies`. The generated client is committed, so a blocked
  postinstall would be harmless anyway.

## 9. Testing

- The old compile-only pattern (Kysely over a never-connected Pool +
  `.compile()` assertions) maps to `Prisma.Sql` builder assertions
  (`query.sql` / `query.values`) for the statements that stayed raw — same
  review value, zero I/O.
- Files whose queries moved to the ORM lost their SQL-shape tests: what those
  pinned (required columns, org_id presence, parameter binding) is enforced at
  compile time by the generated input types. They were replaced by behavioral
  tests against fake `Tx` objects — nested-write shape, the upsert idempotency
  branches, the DbNull sentinel, the event-log fold.
- No database test harness — unchanged, deliberate. Live verification was done
  ad hoc inside rolled-back transactions during the port (§12).
- `withTxContext` (the ALS test helper) is unchanged; service tests swap their
  fake from a Kysely chain stub to a plain object of model-method stubs.

## 10. Tooling deltas (`repel db ...`)

| Command                    | Before                                                                   | After                                                                            |
| -------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `migrations up [match]`    | node-pg-migrate runner, partial apply via `[match]`, then kysely-codegen | `prisma migrate deploy` (all pending, no targeting) + `prisma generate`          |
| `migrations create`        | node-pg-migrate template + JSDoc header                                  | `prisma migrate dev --create-only` + SQL-comment header; review-then-apply       |
| `migrations down [--base]` | node-pg-migrate down                                                     | **removed** — nuke + up                                                          |
| `status`                   | reads `pgmigrations`                                                     | reads `_prisma_migrations` (finished, non-rolled-back rows)                      |
| `nuke`                     | drop schema + codegen                                                    | drop schema only (types come from schema.prisma, not the DB)                     |
| `codegen`                  | kysely-codegen against the **live DB**                                   | `prisma generate` from **schema.prisma** — typegen no longer depends on DB state |

## 11. Commit map

1. `docs:` MIGRATION_NOTES skeleton — intent and section structure first.
2. `feat(db):` Prisma schema + `0_init` baseline + generated client,
   side-by-side; dump-parity verified; nothing consumes it yet.
3. `refactor(db)!:` core swap — client/runtime/types/tx/error/sql;
   `_prisma_migrations` tracking; domain libs intentionally broken until 6.
4. `refactor(accounts,adapters):` accounts to the query API; adapter DTOs
   re-derived from generated input types.
5. `refactor(sync):` verbatim port (CTEs as raw SQL) — superseded by 7.
6. `refactor(queue):` queue port; raw by design; repo green again.
7. `refactor(sync,accounts):` the ORM-ification — review changed the policy
   from "identical statements" to "idiomatic ORM"; commit 5's raw sync CTEs
   became nested writes/upserts/app-code folds. Kept as a separate commit so
   the two styles are both reviewable.
8. `refactor(db,cli):` Prisma Migrate lifecycle; node-pg-migrate deleted;
   differ verified quiet; dev DB baselined.
9. `docs:` this document completed; README + ADR amendments; last kysely
   artifacts removed.

## 12. Verified-during-implementation log

Every planning-time uncertainty, with what turned out to be true (Prisma
7.9.0, adapter-pg 7.9.0, Postgres 16):

- **Generator output**: `client.ts` (entrypoint: PrismaClient const+type,
  `Prisma` namespace, model types, enums re-export), `models.ts` /
  `enums.ts` / `browser.ts` / `commonInputTypes.ts` / `models/*` /
  `internal/*`. `Prisma.TransactionClient`, `Prisma.sql/join/raw/empty`,
  `Prisma.Sql`, `Prisma.DbNull`, `PrismaClientKnownRequestError` all live on
  the generated namespace.
- **`schema.prisma` datasource `url` is a validation error in v7** — config
  moved to `prisma.config.ts` entirely.
- **`prisma.config.ts` `env()` throws at parse time** for unset vars — even
  for commands that never connect (`generate`); the shadow URL entry must be
  conditional.
- **`migrate diff` flag** is `--to-schema` in v7 (renamed from
  `--to-schema-datamodel`).
- **Adapter constructor** accepts an existing `pg.Pool` instance directly.
- **Interactive tx defaults** 2s/5s confirmed (a sync-shaped tx exceeded them
  in planning estimates; 30s ceiling set).
- **Error meta shape** (not public API, pinned by tests):
  `meta.driverAdapterError.cause.originalCode` carries the SQLSTATE for both
  the query API (P2002) and raw queries (P2010); the constraint _name_ exists
  only inside `cause.originalMessage` (`constraint.fields` is the column
  list). Community-reported shapes (`cause.code`, `constraint.index`) were
  wrong for 7.9.
- **25P02 transaction poisoning** (§6) — discovered when the live smoke of the
  try/catch idempotency port failed; drove the upsert design.
- **`dbgenerated("now()")` differ noise** (§4) — discovered via the
  scratch-model differ check; drove the `@default(now())` spelling.
- **Prisma sanitizes `--name`** (dashes → underscores) — the created-dir
  matcher normalizes both sides.
- **Dump parity details**: Prisma emits uniques as `CREATE UNIQUE INDEX`
  (hand-rewritten to constraints), `TIMESTAMPTZ(6)`/`CURRENT_TIMESTAMP`
  spellings differ from the original DDL (`@db.Timestamptz` without precision
  - `DEFAULT now()` in the SQL resolve both).
- **jsonb/bytea/array/Date params through adapter-pg raw queries** behave like
  pg: Date→timestamptz and string[]→text[] bind fine; jsonb params are
  stringified explicitly with `::jsonb` casts rather than trusting inference.
