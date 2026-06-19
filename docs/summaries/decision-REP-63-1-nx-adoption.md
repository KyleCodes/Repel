# DR-REP-63-1: Nx adoption, tag-based boundaries, and the `@nx/js/typescript` sync plugin

**Ticket:** REP-63 ([Arch] Adopt Nx + tag-based module boundaries) — third of three restructure tickets under REP-60.

**Decision:** Adopt Nx on the Bun workspace for the project graph, cached build/test/lint targets, tag-based import boundaries (`@nx/enforce-module-boundaries`), and dependency-declaration enforcement (`@nx/dependency-checks`). Two decisions deliberately **invert or extend the ticket as written**; both are recorded below with rationale.

## What was implemented

- `nx init` (Nx 23.0.0), Bun kept as package manager and runtime (`"packageManager": "bun@1.3.12"`, no npm/yarn lockfile). Projects are inferred from the existing `workspaces` globs — no `project.json` files.
- Tags via `package.json#nx.tags`: every project carries `type:app|lib` + `scope:backend|frontend|shared`; `@repel/backend-adapters` and `@repel/backend-features` additionally carry `area:adapter` / `area:feature`.
- `@nx/js/typescript` plugin provides the cached `build` target (`tsc --build … --emitDeclarationOnly`) and owns each project's `tsconfig.json` `references` via `nx sync`.
- `@nx/eslint/plugin` provides the cached `lint` target. `eslint.config.mjs` carries `@nx/enforce-module-boundaries` + `@nx/dependency-checks`; **all `no-restricted-imports` rules removed.**
- Root scripts route through Nx: `build`/`test`/`lint`/`typecheck` = `nx run-many -t …`; `graph` = `nx graph`. Pre-commit hook runs `nx affected -t lint --uncommitted` (graph-aware) after prettier.

## Decision 1 — adopt the `@nx/js/typescript` sync plugin (INVERTS ticket AC#6 / hard constraint)

**The ticket said do NOT install the sync plugin** (it conflicts with `allowImportingTsExtensions`) and keep maintaining `tsconfig` references by hand. We did the opposite, by user decision.

**Why:** hand-maintained `references` are the footgun deferred item #4 calls out — and it had already bitten: `cli/tsconfig.json` was missing its reference to `@repel/backend-crypto` even though cli imports it. `nx sync` generates references from the dependency graph and `nx sync:check` fails on drift, eliminating the class of bug. The plugin's incompatibility with `allowImportingTsExtensions` is real, so we removed that setting (Decision 2). The original AC#6 ("sync plugin NOT installed") is therefore intentionally not met; this DR is its disposition.

**Caveat recorded:** `nx sync` does **not** manage the root solution `tsconfig.json` `references` — only per-project configs. The root list stays hand-maintained; a new package must be added there by hand. (Validated by running `nx sync` and diffing: root untouched.)

## Decision 2 — drop `.ts` import extensions; type-check-only emit

Removed `allowImportingTsExtensions` and `rewriteRelativeImportExtensions` from the root `tsconfig.json`; added `emitDeclarationOnly: true`. Rewrote ~78 source files' relative imports from `./x.ts` → `./x` (extensionless).

**Why:** the `.ts`-in-import was aesthetic only (the user's words), and it was the sole blocker to the sync plugin. It is cheap to drop because **Bun runs `.ts` source directly** — `tsc` only type-checks and emits `.d.ts` for the composite graph; the emitted `.js` was already dead (every package's `exports` map points at `./src/*.ts`, never `./dist`). Verified: Bun resolves extensionless relative `.ts` imports; `composite + emitDeclarationOnly` is valid TS; CLI boots and queries the DB; all 354 tests pass; web still vite-builds. After the flip, `dist/` holds only `.d.ts` (zero `.js`).

## Decision 3 — Rule 6 via an `area:` tag dimension, not ESLint (extends ticket; resolves deferred item #5)

Manifesto Rule 6 (adapters ↮ features) cannot be expressed by `type:`/`scope:` tags — both libs carry identical `type:lib` + `scope:backend`. Rather than keep a residual `no-restricted-imports` block, we added a third tag dimension `area:adapter` / `area:feature` and two mutual constraints. `no-restricted-imports` is removed entirely; ESLint carries only `@nx/*` rules. Both libs are clean today (neither imports the other), so enforcement broke nothing. This is the "finer tags" question deferred item #5 raised, resolved in the affirmative for exactly this pair.

## Decision 4 — preserve Rule 1a as an explicit constraint (`type:lib ↛ type:app`)

The ticket's listed depConstraints omitted `type:lib ↛ type:app`, which would have silently dropped Manifesto Rule 1a (features↛api/cli) that the old ESLint config enforced. Added `{ sourceTag: 'type:lib', notDependOnLibsWithTags: ['type:app'] }`. Note this is **double-protected**: apps expose no `exports` map (ADR-015), so they are un-importable at module resolution regardless — the tag constraint is the belt to that braces. Verified: making an app temporarily exportable makes the rule fire immediately.

## Decision 5 — dependency-declaration enforcement at `error`, pre-commit only (resolves deferred item #1)

`@nx/dependency-checks` at severity `error` from day one: a package may not import anything its own `package.json` does not declare (no hoisting / global-install free-rides). REP-61's hand-fixes were verified by it; one real finding surfaced and was fixed — `pg` in `@repel/backend-features` was a **test-only** dependency, so it moved from `dependencies` to `devDependencies` (the rule scopes "used" to production files; test-only deps belong in devDependencies). `vite` + `@vitejs/plugin-react` are `ignoredDependencies` (build tooling consumed by `vite.config.ts`, legitimately devDeps). Web's not-yet-imported SPA deps (`@tanstack/*`, `zustand`) were parked under a `_futureDependencies` key to keep the gate green until the SPA imports them. Enforced at **pre-commit only — no CI workflow** (user decision; repo has no CI today). Because `@nx/enforce-module-boundaries` is silently skipped when run via raw `eslint` (no project graph), the hook and the root `lint` script run `nx lint`, never bare `eslint`.

## Deferred items disposition (from the REP-63 comment)

1. **Dep-declaration enforcement** — DONE via `@nx/dependency-checks` (Decision 5).
2. **Intra-package layer enforcement** (only a feature's `service.ts` imports its own `views/`/`mutations/`) — still a reviewed convention. Cross-package is covered by the `exports` map; intra-package needs per-feature packages or a custom rule. Noted in manifesto §5 Rule 1b. **OPEN.**
3. **Rename the `features` layer** — still open; no candidate name fit. Revisit when manifesto vocabulary is next reworked. Not blocking. **OPEN.**
4. **`tsconfig` references footgun** — DONE via `nx sync` (Decision 1), except the root solution config stays hand-maintained (caveat above).
5. **Nx tags for the split shared packages** — each shared package carries `type:lib` + `scope:shared`; no finer tags warranted. The `area:` dimension was instead applied to the adapters/features pair (Decision 3).

## Non-goals (carried from ticket)

- No `bun build --compile` Nx targets — deferred to staging/prod deploy. `nx build` validates + emits `.d.ts` only; web additionally runs `vite build`. No runnable backend binaries yet.
- No remote cache (cross-OS binary cache is broken; out of scope).
- No `services run` verb / `consumer` lib (separate tickets).

## Verification (all green)

`nx graph` renders 15 projects with correct edges; every project tagged; `nx run-many -t build,test` passes with 30/30 cache hit on rerun; `nx sync:check` clean; `tsc --build` clean after the extension drop. Deliberate-violation matrix: frontend→backend, shared→backend, adapters↔features all fail `nx lint`; the real `adapters→db` edge does not false-positive; the dependency-check blocks an undeclared `import 'zod'`.
