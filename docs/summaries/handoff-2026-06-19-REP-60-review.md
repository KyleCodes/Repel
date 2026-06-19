# Session Handoff: REP-60 epic — monorepo restructure + Nx adoption (REP-61, REP-62, REP-63)

**Date:** 2026-06-19
**Session Duration:** multi-session (spans REP-61 → REP-62 → REP-63; this handoff is the epic-level wrap)
**Session Focus:** Close out epic REP-60 — relocate code into a platform-grouped tree and layer Nx on top for graph-aware caching + tag-based module boundaries.
**Context Usage at Handoff:** ~high (compacted twice during REP-63)

## Epic shape

REP-60 is the parent epic. Three sequential restructure tickets, each one squashed commit, each its own PR:

| Ticket | What                                                | Commit    | PR  | State                     |
| ------ | --------------------------------------------------- | --------- | --- | ------------------------- |
| REP-61 | Relocate backend → `packages/backend/{apps,libs}`   | `4df0f38` | #25 | **MERGED**                |
| REP-62 | Relocate frontend → `packages/frontend/{apps,libs}` | `e5336aa` | #26 | **MERGED**                |
| REP-63 | Adopt Nx + tag-based module boundaries              | `681c18c` | #27 | **OPEN** (awaiting merge) |

The only open work is merging PR #27.

## What Was Accomplished

### REP-61 (backend relocation) — MERGED

1. Backend code moved into `packages/backend/apps/{api,cli,worker}` and `packages/backend/libs/*` (git mv, exports maps + tsconfig references rewired). Drained old `apps/server`.

### REP-62 (frontend relocation) — MERGED

2. `apps/web` → `packages/frontend/apps/web`; tsconfig `extends` re-pathed (`../../../../tsconfig.json`) + reference to `../../../shared/enums`; wired the `@repel/enums` import in `main.tsx`; web build green; `apps/` drained.
3. devctl repo.conf path repair (clone/drop now target `packages/backend/apps/cli`); root `.env.development` relocated to `packages/backend/`; CLI exit-code bug fixed (`program.exitOverride()` — false exit 1 on group help); `apps/server` stragglers deleted.

### REP-63 (Nx adoption) — OPEN (PR #27)

4. Full Nx 23 adoption: project graph (15 projects inferred from `workspaces` globs, no `project.json`), cached `build`/`test`/`lint` targets, `@nx/js/typescript` sync plugin owning per-project tsconfig `references`, `@nx/enforce-module-boundaries` (tag-based) replacing all `no-restricted-imports`, `@nx/dependency-checks` (error severity) enforcing declared deps.
5. `.ts` import extensions dropped repo-wide (78 files codemod) + root tsconfig flipped to `emitDeclarationOnly` (removed `allowImportingTsExtensions`/`rewriteRelativeImportExtensions`). DR records both ticket inversions.
6. Husky hook expansion: pre-commit (`lint-staged` + `nx affected -t lint,build --uncommitted`), pre-push (`nx affected -t build,test --base=main`), post-merge/checkout/rewrite (non-blocking `nx run-many -t build` rewarm). post-rewrite stale-path fix.
7. Worktree integration: `.nx/` added to repo.conf `EXTRA_SKIP_DIRS` (never symlink the SQLite graph DB across worktrees); `bun run build` warm-step added to `on_start`.
8. Docs: manifesto §3/§5 rewritten to platform-grouped tree + Rule 9 (tag table); ADR-003 amended (per-app entrypoints replace MODE); ADR-009/012 path notes; `decision-REP-63-1-nx-adoption.md`.
9. **This session's adds (folded into `681c18c`):** `dev:watch` script (`nx watch --all` running build+test on the changed project, interleaved stream) and `parallel: 8` default in `nx.json`.

## Decisions Made This Session

- **DR-REP-63-1** (see `./docs/summaries/decision-REP-63-1-nx-adoption.md`): two deliberate inversions of the REP-63 ticket — (a) the `@nx/js/typescript` sync plugin IS adopted (ticket said "do not install") so Nx owns tsconfig references; (b) `.ts` import extensions dropped + `emitDeclarationOnly` (ticket said "do not change TS settings"). Both user-directed.
- **Boundary enforcement via Nx tags, not ESLint globs**: `type:`/`scope:`/`area:` tags; Rule 6 (adapters↔features) is `area:`-enforced. `no-restricted-imports` removed entirely. STATUS: confirmed.
- **Dep declaration fails loudly**: `@nx/dependency-checks` at `error` from day one — importing an undeclared (globally-hoisted) package blocks. STATUS: confirmed.
- **No CI, no Nx Cloud**: enforcement is pre-commit/pre-push only; `analytics: false`. STATUS: confirmed (user's self-hosted ethos).
- **Worktrees do NOT share `.nx/`**: each owns a fresh graph DB + cache, rebuilt on `on_start`. BECAUSE concurrent SQLite writers → corruption + Nx-version skew. STATUS: confirmed.
- **`parallel: 8`** (this session): matched to 8 performance cores (12 logical). BECAUSE 12 risks oversubscription (bun test spawns internal threads). STATUS: confirmed.

## Key Numbers Generated or Discovered This Session

- Nx projects: **15** (3 backend apps + 7 backend libs + 1 web + 4 shared) — earlier prose said 16, reconciled to 15.
- Codemod (`.ts`→extensionless): **78 files / 172 occurrences** changed.
- REP-63 commit `681c18c`: **110 files, +1593 / -355**.
- Cold `nx run-many -t build`: **2.6s @ parallel=8 (107% CPU) vs 3.6s serial (75% CPU)** — modest win; dep chain is mostly linear so `^build` serializes much of it. Wins concentrate on the 4 independent shared leaves.
- `nx affected -t build,test --base=main` on push: 30/30 cache hit.
- `tsc` is **single-threaded, no parallelism flag** — verified against `tsc --build --help`. Nx running N `tsc` processes concurrently is the ONLY TS speedup lever.

## Conditional Logic Established

- IF running boundary/dep-check rules THEN invoke via `nx lint` (not raw `eslint`) BECAUSE `@nx/enforce-module-boundaries` is silently SKIPPED without a cached project graph.
- IF on a stacked branch THEN `nx affected` needs `--base=<parent>` BECAUSE it defaults base to `main`.
- IF a dep is test-only THEN it belongs in `devDependencies` BECAUSE `@nx/dependency-checks` scans the build target's `production` input which excludes tests (this is why `pg` moved to devDeps in features).
- IF forcing a fresh build THEN `--skip-nx-cache` (passes through `bun run build -- --skip-nx-cache`).
- IF apps need to be import-blocked THEN rely on no-exports-map (un-importable, no graph edge) AS WELL AS the tag rule — the tag rule alone can't flag an edge that doesn't resolve. Defense-in-depth, documented.

## Files Created or Modified (this session only)

| File Path                                            | Action   | Description                                                                            |
| ---------------------------------------------------- | -------- | -------------------------------------------------------------------------------------- |
| `package.json`                                       | Modified | Added `dev:watch` script (folded into `681c18c`)                                       |
| `nx.json`                                            | Modified | Added `parallel: 8` (UNCOMMITTED at time of writing — being folded into `681c18c` now) |
| `docs/summaries/handoff-2026-06-19-REP-60-review.md` | Created  | This file                                                                              |

## What the NEXT Session Should Do

1. **First**: Confirm PR #27 (REP-63) is green and merge it. https://github.com/KyleCodes/Repel/pull/27
2. **Then**: Mark REP-63 Done in Linear (squash already done — single commit `681c18c`). Mark epic REP-60 Done once #27 merges.
3. **Then**: If picking up Nx follow-ups, the live candidates are the custom `repel-lib`/`repel-app` generator (encodes manifesto package shape: tags, exports map, directory placement — turns Rule-by-memory into a command) and graph-aware long-running serve targets (`@nx/js:node` or `bun --watch` per app, optionally tmux-pane auto-spawn). Neither is ticketed yet.

## Open Questions Requiring User Input

- **OPEN:** Custom Nx generator scope — whether `area:` is a locked enum (`adapter`/`feature`) or free-form — needs user decision before building the generator. (Recommended: locked.)

## Assumptions That Need Validation

- **ASSUMED:** `bun --watch` catches upstream cross-package changes (because imports resolve through `src/`) — validate by editing a `@repel/backend-db` file while a `bun --watch` worker runs and confirming restart. If it misses, `@nx/js:node` executor is needed for graph-aware restart.

## Deferred items (NOT yet Linear tickets — from DR-REP-63-1)

- Intra-package layer enforcement (e.g. feature → sibling `views/`) — still convention (Rule 1b); needs per-feature projects or a custom rule.
- `features` layer/lib rename — revisit once manifesto vocab locked.
- `bun build --compile` Nx targets for app binaries — deferred to deploy-time (ticket non-goal); cross-OS binary cache is broken so no remote cache for these.

## What NOT to Re-Read

- `docs/summaries/decision-REP-63-1-nx-adoption.md` — the canonical record of REP-63 decisions; read it directly rather than re-deriving from the diff.
- REP-61/REP-62 diffs — merged and stable; the relocation is done, don't re-audit paths.

## Files to Load Next Session

- `docs/summaries/decision-REP-63-1-nx-adoption.md` — the two ticket inversions + deferred-item dispositions.
- `nx.json`, `eslint.config.mjs` — the boundary/cache/parallelism config, if touching Nx behavior.
- `docs/04-architecture-manifesto.md` §3/§5 — current layout + tag rules (Rule 9).
