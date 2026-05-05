# Handoff — REP-19 Plan

**Date:** 2026-05-04
**Ticket:** REP-19 — repel db CLI: create, migrate, status, connect, query (zod, restructure)
**Phase:** plan
**Branch:** kylemuldoon15/rep-19-repel-db-migrate-status-rollback

## State

REP-19 was underspecified. Pre-planning conversation (2026-05-04) replaced the original `migrate/status/rollback` framing with a broader epic-style scope covering the full `repel db` CLI surface plus zod adoption and CLI restructure. The plan was approved and is on disk at `/Users/kylemuldoon/.claude/plans/this-ticket-is-underspecified-harmonic-wilkinson.md`.

`/linear-plan` rewrote REP-19 in Linear and created 3 sub-tickets. Architecture plan and 11 DRs are written to disk.

## Linear changes

**REP-19 (parent) — rewritten:**
- New title: `repel db CLI: create, migrate, status, connect, query (zod, restructure)`
- Project: `CLI Everything` (unchanged)
- Milestone: `CLI Scaffolding & Bootstrap` (unchanged)
- Status: In Progress (auto-set when children created)
- Description rewritten with Summary / Sub-tickets / Acceptance criteria / Decisions / Out of scope sections.

**Sub-tickets created** (all `parent=REP-19`, `project=CLI Everything`, `milestone=CLI Scaffolding & Bootstrap`, priority Medium):

| ID | Title |
|---|---|
| REP-38 | T1 — Foundation: zod 4, CLI restructure, ADR-012, rename initial migration |
| REP-39 | T2 — Migrate command set + status |
| REP-40 | T3 — Connect & query |

**Dependency order:** REP-39 and REP-40 both depend on REP-38. REP-39 and REP-40 are independent of each other.

## Decision Records

Per `docs/06-ticket-conventions.md`: DRs default to Linear comments; only those with cross-ticket reach are promoted to disk.

**On disk (2 — cross-ticket reach):**
- DR-REP-39-1 — Migration filename format `<unix-ms>_<rep-NN>.ts` (`docs/summaries/decision-REP-39-1-filename-format.md`)
- DR-REP-40-1 — `.env.local` sole source for `DATABASE_URL` (`docs/summaries/decision-REP-40-1-env-local-sole-source.md`)

**Linear comments only (9 — ticket-internal):**
- DR-REP-38-1 (zod root install), DR-REP-38-2 (handler signature — covered by ADR-012 once ratified), DR-REP-38-3 (CLI layout — covered by ADR-012), DR-REP-38-4 (rename initial migration)
- DR-REP-39-2 (create impl), DR-REP-39-3 (docstring header), DR-REP-39-4 (up/down arg-shape), DR-REP-39-5 (status custom impl)
- DR-REP-40-2 (query JSON output)

All 11 DRs are posted as Linear comments on the corresponding sub-tickets.

## Architecture plan

`docs/summaries/architecture-REP-19.md` — full plan. Canonical source for `/linear-execute` runs.

## Proposed ADRs

- **ADR-012: CLI structure convention** — `cli/<namespace>.ts` (Commander registrar + inline handlers) + colocated `cli/schemas/<namespace>.ts` (zod input schemas). Drafted as PROPOSED during REP-38 execution; ratified via `/ratify-adr` as part of T1's acceptance criteria. File: `docs/context/adr/ADR-012-cli-structure-namespace-and-schemas.md` (to be created in T1).

## Files referenced (codebase)

Existing (relevant to all 3 sub-tickets):
- `apps/server/src/cli.ts` — top-level Commander entry; will update import path in T1.
- `apps/server/src/db/admin/cli.ts` — current registrar; deleted in T1.
- `apps/server/src/db/admin/commands.ts` — clone/drop/refresh-template DB ops; reused unchanged.
- `apps/server/src/db/admin/lib/admin-url.ts` — admin URL resolver; reused unchanged.
- `apps/server/src/db/client.ts` — pg/Kysely client; reused for `db status` and `db query`.
- `apps/server/src/db/runtime.ts` — `getDb()`, `closeDb()`; reused.
- `apps/server/src/db/migrations/0001_initial_schema.ts` — renamed in T1.
- `package.json` (root) — adds `zod@^4` (T1), removes `migrate:*` scripts (T2).
- `packages/shared/package.json` — removes `zod@3` (T1).
- `/Users/kylemuldoon/.devctl-config/repos/Repel/repo.conf` — devctl `on_start` calls `db clone`; no change.

To be created:
- `apps/server/src/db/admin/cli/db.ts` (T1)
- `apps/server/src/db/admin/cli/schemas/db.ts` (T1)
- `apps/server/src/db/admin/cli/lib/branch.ts` (T1)
- `apps/server/src/db/admin/cli/lib/env-local.ts` (T1)
- `docs/context/adr/ADR-012-cli-structure-namespace-and-schemas.md` (T1)

## Open questions

- **ASSUMED:** `node-pg-migrate create` prints generated path to stdout in a parseable form. Validate empirically during REP-39 before implementing post-processor; fallback = newest-mtime scan in migrations dir. — flagged on REP-39 DR-2.
- **ASSUMED:** zod 4 has no breaking changes affecting our usage (only `z.object`, `z.string`, `z.optional`, `safeParse`, `z.infer`). Verify against zod 4 changelog when implementing REP-38.

## Milestone GAPs

None. All three sub-tickets share the parent's milestone (`CLI Scaffolding & Bootstrap`).

## Next action

Run `/linear-execute REP-38` to begin T1. T2 (REP-39) and T3 (REP-40) can run in parallel after T1 lands, as they're independent of each other.
