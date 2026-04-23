# Session Handoff: REP-9 Implementation Landed
**Date:** 2026-04-22
**Session Duration:** ~one focused execution session
**Session Focus:** Implement REP-9 end-to-end (with absorbed REP-5 + REP-8 scope) per the 2026-04-18 plan, plus the additional cleanup items surfaced during execution. PR opened against main; not merged.
**Phase:** execute → review

---

## TL;DR for the reviewer

REP-9 is implemented across 11 commits on `kylemuldoon15/rep-9-rename-domains-core-adopt-runinorgtx-decorator-land-coreacme`. The branch is ready for review and squash-on-merge. All health gates pass: typecheck clean, 12 tests pass, grep gate zero matches, CLI bootstrap end-to-end works against a migrated branch DB, RLS isolation verified under a non-owner role, dedup_key partial unique idx blocks duplicates, migration `down` rolls back cleanly.

The folded REP-8 scope (schema doc + v0 migration) lands in the same PR.

---

## Commits on this branch (11)

In order:

1. `4845a42` Rewrite docs/03-sql-schema.md for v0
2. `e916a99` Update @repel/shared enums to ADR-005 values
3. `e9f543e` Update db/types.ts for v0 schema
4. `70eb21a` Rewrite v0 migration for new schema
5. `1a3fa36` Port db/tx.ts decorator model from template
6. `ff0376f` Move domains/ → core/, flatten services, add acme reference vertical
7. `d271efb` Port db/__tests__/tx.test.ts from template
8. `e2eb60a` Vestigial cleanup: archive stale docs, fix README, rename LICENSE typo
9. `e985797` Update docs/04-application-architecture.md (targeted)
10. `201a1a2` Add bun-types for tsc to resolve bun:test in tx tests
11. `f633763` Document RLS owner-role behavior in v0 migration

Per Kyle (2026-04-22): push as a chain so the reviewer sees one-commit-per-task narrative; squash on merge.

---

## What landed

### Schema + v0 migration (absorbed REP-8)

- `docs/03-sql-schema.md` — full rewrite. provider_account per ADR-005; channel/provider/auth_method enums; dedup_key on job_queue + partial unique idx; derived-fact tables removed (placeholder → docs/design_ideas/derived-fact-model.md); acme reference vertical; UNIQUE(org_id, email) on user; UNIQUE(contact_id, channel, handle) on contact_handle.
- `apps/server/src/db/migrations/0001_initial_schema.sql` — full rewrite with node-pg-migrate `-- Up Migration` / `-- Down Migration` markers (file previously had neither; rollback would not have worked). RLS ENABLE only (no FORCE) — owner-role bypass is intentional per ADR-002; documented inline in the migration.

### Decorator model + core/ rename (REP-9 original)

- `apps/server/src/db/tx.ts` — verbatim port from `~/Developer/monorepo_template/apps/server/src/db/tx.ts`. Exports `runInOrgTx`, `runInTx`, `withTxContext`, `OrgScoped<A>`, `TxContext`. Old `withTx`/`withOrgTx` removed.
- `apps/server/src/db/repos.ts` — drops `providers`, adds `acme`, references `core/` paths.
- `apps/server/src/db/types.ts` — `ConnectedAccountTable` → `ProviderAccountTable` per ADR-005 (added `externalAccountId`, `alias`); derived-fact tables dropped; `dedupKey` added to `JobQueueTable`; `AcmeTable` + `AcmeRow`/`NewAcme`/`AcmeUpdate` added; channel/provider unions updated.
- `apps/server/src/db/runtime.ts` — added `closeDb()` (CLI exit was 10s without it; now ~100ms).
- `apps/server/src/db/__tests__/tx.test.ts` — verbatim port of 6 tx guard tests (no DB required; uses `withTxContext` to set ALS).
- `apps/server/src/core/{org,user,account-setup}/` — moved from `domains/` via `git mv` (history preserved). All three services rewritten as module-level singletons with `runInOrgTx` / `runInTx` decorators. `*Impl` exports on `org.createOrg` and `user.createUser` for composition inside `account-setup.bootstrap` (per ADR-009).
- `apps/server/src/core/acme/{repo,service,types,mappers}.ts` — new reference vertical. Header comment in `service.ts` marks it for future deletion.
- `apps/server/src/cli.ts` — drops `add-account` registration (depended on deleted `providers/`); imports from `core/account-setup/`; calls `closeDb()` in `finally` block.
- `apps/server/src/api/router.ts` — comment updated to reflect decorator model (no functional change).
- Deleted: `apps/server/src/domains/{providers,org,user,account-setup}/`. Kept: `domains/dev-db/` (REP-32 scope).

### Vestigial cleanup (added during execution)

Per repo audit on 2026-04-22 — these are demonstrably stale, not vague drift:

- Archived to `docs/archive/`: `kysely_fp_full.md` (describes superseded `withTx` + factory pattern), `scaffold-cleanup.md` (its own "triggers that close this file" all fired in this commit).
- `README.md` — channels line updated to ADR-005 values (was: linkedin/imessage/slack/discord/whatsapp).
- `LISCENSE` → `LICENSE` (typo fix via `git mv`).
- `docs/04-application-architecture.md` — targeted updates to Project Structure, Database Layer, Backend Entrypoints sections. Drift notice added at the top. Channel adapter / pipeline / agent / API route sections preserved as-is — they describe v1 target shape and will be rewritten under follow-up tickets.

### Build/tooling

- `bun-types` added as root devDependency. `apps/server/tsconfig.json` `types: ["bun-types"]` so `tsc --build` resolves `bun:test`.

### Linear

- REP-9 description updated to reflect absorbed REP-8 + REP-5 scope.
- REP-8 marked Duplicate of REP-9.
- REP-5 already Duplicate from prior session.

---

## Plan-vs-actual divergences during execution

1. **`api/router.ts` had a comment about `withOrgTx`** that wasn't in the original handoff. Updated.
2. **Existing `0001_initial_schema.sql`** lacked node-pg-migrate up/down markers — would not have rolled back. Added markers as part of the rewrite.
3. **Stale `dist/` build artifacts** caused initial typecheck failures (TS6305). Resolved by running `tsc --build --force` once. No source changes needed.
4. **`bun:test` not resolvable by tsc** — tests passed at runtime but tsc didn't know `bun:test` existed. Added `bun-types` devDep + `types: ["bun-types"]` to `apps/server/tsconfig.json`.
5. **RLS bypass under owner role** discovered during smoke. Initially considered adding `FORCE ROW LEVEL SECURITY` but reverted — bootstrap (`runInTx` without `app.current_org_id`) needs RLS bypass and ADR-002 explicitly accepts owner-role bypass as the bootstrap mechanism. Documented inline in the migration.

## Resolved decisions from this session (worth re-reading on review)

1. `domains/account-setup/` → migrated to `core/account-setup/` (not deleted as `scaffold-cleanup.md` suggested). Becomes the canonical reference for `runInTx` + `*Impl` composition.
2. `add-account` CLI command → dropped. `providers/` is deleted; real CLI lands in REP-11.
3. `packages/shared/src/enums.ts` → updated to ADR-005 values.
4. `user.email` → `UNIQUE (org_id, email)` rather than global `UNIQUE`. Multi-tenancy correctness.
5. Vestigial cleanup wins (archive 2 docs, README line, LICENSE rename) bundled into this PR rather than a separate cleanup ticket — they're <1 minute of review burden combined and cleanly delimited as one commit.

---

## Health gates (final state)

- `bun run typecheck` → clean
- `bun test` → 12 pass, 0 fail (6 ported tx guard tests + 6 pre-existing)
- Grep gate (`grep -rE 'withOrgTx|withTx\b|makeRepos\b|make[A-Z][a-zA-Z]+Service' apps/server/src/{api,core/**/cli.ts,main.ts,cli.ts}`) → zero matches
- DB smoke test against branch DB (`repel_rep_9_smoketest` cloned from `repel_dev`):
  - Migration up: clean
  - `bun run cli bootstrap --org-name "Smoke Org" --email smoke@example.com --name "Smoke"` → succeeds; org + user created
  - RLS check (under newly-granted non-owner role `rls_test`): `SET LOCAL app.current_org_id = '<real-org>'` → 1 user; `SET LOCAL app.current_org_id = '00000000-...'` → 0 users
  - dedup_key partial unique idx: second `INSERT INTO job_queue (..., dedup_key) VALUES ('test', ..., 'key-1')` fails as expected
  - Migration down: clean (only `pgmigrations` table remains)
  - Smoke DB + test role cleaned up after verification

---

## Open items (not in Linear yet)

- **Filing 3 follow-up tickets**: Linear MCP token expired during the execution session. Need to file:
  1. *Align docs/01-product-spec.md with ADR-005 v1 channel scope* (parent: REP-7, project: Foundations, priority: Low)
  2. *Rewrite docs/05-code-conventions.md against current architecture* (same parents)
  3. *Full rewrite of docs/04-application-architecture.md* (after REP-11 + pipeline scaffolding lands; the current targeted updates have a drift notice that needs removal)

- **REP-32** (dev-db relocation) is unaffected by this ticket; `domains/dev-db/` stays put.

- **REP-10/11/12** inherit the contract set by this ticket. REP-10 may collapse into REP-9 effectively — the singleton service flattening + `*Impl` lifting on `org` + `user` already happened here; the remaining REP-10 delta is "against the real schema," which is also done.

---

## Files changed (summary)

```
docs/03-sql-schema.md                                     | rewrite
docs/04-application-architecture.md                       | targeted updates
docs/archive/kysely_fp_full.md                            | moved from docs/design_ideas/
docs/archive/scaffold-cleanup.md                          | moved from docs/design_ideas/
docs/summaries/handoff-2026-04-22-REP-9-execute.md        | this file (added)
LICENSE                                                   | renamed from LISCENSE
README.md                                                 | one-line channels update
apps/server/package.json                                  | (no change in this PR — root holds bun-types)
apps/server/tsconfig.json                                 | types: ["bun-types"]
apps/server/src/api/router.ts                             | comment update
apps/server/src/cli.ts                                    | rewrite (drop add-account, core/ paths, closeDb)
apps/server/src/core/acme/{repo,service,types,mappers}.ts | new (4 files)
apps/server/src/core/account-setup/{cli,service,types}.ts | rewrite (singleton, runInTx)
apps/server/src/core/org/{repo,mappers,types}.ts          | moved from domains/
apps/server/src/core/org/service.ts                       | rewrite (singleton, runInTx + runInOrgTx + Impl)
apps/server/src/core/user/{repo,mappers,types}.ts         | moved from domains/
apps/server/src/core/user/service.ts                      | rewrite (singleton, runInTx + runInOrgTx + Impl)
apps/server/src/db/__tests__/tx.test.ts                   | new (6 tests, verbatim port)
apps/server/src/db/migrations/0001_initial_schema.sql     | rewrite (up/down markers, new schema)
apps/server/src/db/repos.ts                               | drop providers, add acme, core/ paths
apps/server/src/db/runtime.ts                             | add closeDb()
apps/server/src/db/tx.ts                                  | rewrite (decorator model, verbatim port)
apps/server/src/db/types.ts                               | rewrite (provider_account, dedup_key, acme, drop derived)
apps/server/src/domains/{providers,org,user,account-setup}/ | DELETED
bun.lock                                                  | bun-types
package.json                                              | bun-types devDep
packages/shared/src/enums.ts                              | ADR-005 values
```

`apps/server/src/domains/dev-db/` untouched (REP-32 scope).

---

## What the next session should do

This handoff is for the **reviewer**, not for picking up new work. The flow from here:

1. Review the PR (link in the PR description / repo PR list).
2. Squash on merge per CLAUDE.md rule 10 + Kyle's preference.
3. After merge: re-auth Linear MCP, file the 3 follow-up tickets listed above, mark REP-9 Done.

If review surfaces blocking changes, the chain-of-commits structure on the branch lets specific commits be amended individually before final squash.
