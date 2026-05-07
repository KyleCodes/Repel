# Architecture Plan — REP-19

**Ticket:** REP-19 — repel db CLI: create, migrate, status, connect, query (zod, restructure)
**Project:** CLI Everything
**Milestone:** CLI Scaffolding & Bootstrap
**Source plan:** `/Users/kylemuldoon/.claude/plans/this-ticket-is-underspecified-harmonic-wilkinson.md` (approved 2026-05-04)
**Sub-tickets:** REP-38 (T1), REP-39 (T2), REP-40 (T3)

## Goal

Expand the `repel db` CLI (Commander, registered at `apps/server/src/cli.ts`) into the canonical interface for all developer-facing database operations. Replace the loose `npm run migrate:*` scripts with `db migrate {create|up|down}`, add `db status`, `db connect`, `db query`. Drop "rollback" from the original framing — `migrate down [target]` covers it.

Two cross-cutting concerns ride along:

1. Adopt **zod ^4** as the monorepo-wide validation library, replacing the unused `zod@3` in `packages/shared`.
2. Restructure `apps/server/src/db/admin/cli.ts` → `apps/server/src/db/admin/cli/db.ts` (Commander wiring + inline handlers) with colocated `cli/schemas/db.ts` (per-namespace zod schemas).

## Current state (relevant facts)

- Commander entry: `apps/server/src/cli.ts` → `registerDevDbCommands()` in `apps/server/src/db/admin/cli.ts`. Existing subcommands: `db clone`, `db drop`, `db refresh-template`.
- Migrations: `apps/server/src/db/migrations/0001_initial_schema.ts` (single file, sequential-index, manual pre-tooling).
- `npm run migrate:{create,up,down}` shell out directly to `node-pg-migrate`.
- node-pg-migrate exposes `runner()` programmatically. **No** programmatic `create` API. **No** native `status` command.
- Per-worktree DB: `db clone` writes `DATABASE_URL` to `.env.local` (mode 0o600); `.env.local` is the source of truth in worktrees.
- Zod usage today: only declared in `packages/shared/package.json` at `^3`; no source code imports it. Migration blast radius ≈ 0.

## Target architecture

### Layout

```
apps/server/src/db/admin/cli/
  db.ts                             # registerDevDbCommands(); Commander wiring +
                                    # inline runClone, runDrop, runRefreshTemplate,
                                    # runMigrateCreate, runMigrateUp, runMigrateDown,
                                    # runStatus, runConnect, runQuery
  schemas/
    db.ts                           # zod input schemas for the `db` namespace:
                                    #   CloneInput, DropInput, RefreshTemplateInput,
                                    #   MigrateCreateInput, MigrateUpInput, MigrateDownInput,
                                    #   StatusInput, ConnectInput, QueryInput
  lib/
    branch.ts                       # getCurrentBranch(), extractTicketSlug(branch)
    env-local.ts                    # readDatabaseUrlFromEnvLocal()
```

`apps/server/src/cli.ts` updated import: `from './db/admin/cli/db'`. Existing `apps/server/src/db/admin/lib/admin-url.ts` and `apps/server/src/db/admin/commands.ts` stay (domain logic, not CLI plumbing).

### Handler contract

Every Commander `.action(...)` does:

1. Construct an args object from positional args + options.
2. `Schema.safeParse(args)` against the matching zod schema in `schemas/db.ts`.
3. On `success: false`, print formatted issues, exit non-zero.
4. On success, `await runX(parsed.data)` — `runX` accepts a single typed arg, type inferred via `z.infer`.

### Filename convention for migrations

`<unix-ms>_<rep-NN>.ts` (e.g., `1714838422000_rep-19.ts`). Slug derived from the current git branch via `extractTicketSlug` (regex `rep-\d+`, case-insensitive). Default-applied by `db migrate create` when no name passed.

`0001_initial_schema.ts` is renamed in T1 to `<unix-ms>_rep-9.ts` for consistency. PR includes a one-line `pgmigrations` UPDATE for any local DB that has the old row.

### Migrate target resolver

`db migrate {up|down} [target]`:

- target omitted → `up` = `runner({ count: Infinity, direction: 'up' })`; `down` = `runner({ count: 1, direction: 'down' })`.
- target matches `/^\d+$/` → timestamp-prefix range. `runner({ count: <ts>, timestamp: true, direction })`. Up applies all pending where filename-ts ≤ target; down rolls back all applied where filename-ts ≥ target.
- Otherwise → exact filename. `runner({ file: <name>, direction })`.

### Migration `create` impl

Shell out to `node-pg-migrate create` (existing path), parse stdout for the generated path, read the file, prepend a docstring header, write back. Header:

```ts
/**
 * Migration: <name>
 * Branch:    <full-branch-name>
 * Ticket:    <REP-NN extracted from branch, or "unknown">
 * Created:   <ISO-8601 UTC>
 */
```

If stdout parsing is unstable across versions, fallback: scan `apps/server/src/db/migrations/` for newest mtime.

### Status impl

Custom: `SELECT name FROM pgmigrations` via existing pg client (`apps/server/src/db/client.ts`), `fs.readdirSync('apps/server/src/db/migrations/')`, partition by name into `applied | pending | orphaned`, render as a table.

### Connect & query

- `connect`: `child_process.spawn('pgcli', [DATABASE_URL], { stdio: 'inherit' })`. `DATABASE_URL` from `.env.local` only; no `process.env` fallback.
- `query <sql>`: existing pg client; `JSON.stringify(rows)` to stdout; `sql === '-'` reads from stdin; non-zero exit on SQL error.

### Zod install

- Add `zod@^4` to root `package.json` dependencies.
- Remove `zod@3` from `packages/shared/package.json`.
- Bun workspace hoist puts a single `^4` in `node_modules`.

## Sub-ticket scope and ordering

- **REP-38 (T1) — Foundation.** No new commands. Restructure, schemas for existing 3 commands, branch/env libs, rename initial migration, ratify ADR-012. End state: existing CLI works identically.
- **REP-39 (T2) — Migrate + status.** Depends on T1. Adds `migrate {create,up,down}` and `status`. Removes old npm scripts.
- **REP-40 (T3) — Connect + query.** Depends on T1. Adds `connect` and `query`.

T2 and T3 are independent of each other.

## Files touched (rollup)

**New:**

- `apps/server/src/db/admin/cli/db.ts`
- `apps/server/src/db/admin/cli/schemas/db.ts`
- `apps/server/src/db/admin/cli/lib/branch.ts`
- `apps/server/src/db/admin/cli/lib/env-local.ts`
- `docs/context/adr/ADR-012-cli-structure-namespace-and-schemas.md`

**Modified:**

- `apps/server/src/cli.ts` (import path)
- `package.json` (root) — `+zod@^4`, `-migrate:*` scripts
- `packages/shared/package.json` — `-zod@3`
- `docs/context/adr/index.md` (ADR-012 entry)

**Deleted:**

- `apps/server/src/db/admin/cli.ts`

**Renamed:**

- `apps/server/src/db/migrations/0001_initial_schema.ts` → `<unix-ms>_rep-9.ts`

## Open / Assumed

- **ASSUMED:** `node-pg-migrate create` prints generated path to stdout in a parseable form. Validate empirically in T2 before implementing post-processor; fallback = newest-mtime scan.
- **ASSUMED:** zod 4 has no breaking changes affecting our usage (only `z.object`, `z.string`, `z.optional`, `safeParse`, `z.infer`). Verify against zod 4 changelog when implementing T1.
- **OPEN (resolved):** T3 split — kept as one ticket, small but cohesive.

## Verification (end-to-end after all 3 sub-tickets land)

- `bun apps/server/src/cli.ts db migrate create` (no name, on a `rep-NN` branch) generates `<ts>_rep-NN.ts` with header populated.
- `db migrate up` applies all pending; `db status` shows applied.
- `db migrate down <ts-of-newest>` rolls back only that migration; `db status` shows it pending.
- `db connect` opens an interactive pgcli session.
- `echo "SELECT 1 AS x" | bun apps/server/src/cli.ts db query -` prints `[{"x":1}]`.
- Root `package.json` has no `migrate:*` scripts.
- `node_modules/zod/package.json` shows `^4.x`; `packages/shared/package.json` has no `zod` entry.
