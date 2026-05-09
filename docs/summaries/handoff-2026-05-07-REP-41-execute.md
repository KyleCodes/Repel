# Handoff — REP-41 Execute

**Ticket:** [REP-41 — Prettier (+ Husky + lint-staged), .js → .ts source imports](https://linear.app/repel/issue/REP-41/prettier-husky-lint-staged-js-ts-source-imports)
**Phase:** execute
**Date:** 2026-05-07
**Branch:** `kylemuldoon15/rep-41-prettier-husky-lint-staged-js-ts-source-imports`
**Status:** Implementation complete; PR pending.

## What was done

1. Installed devDeps: `prettier@3.8.3`, `@trivago/prettier-plugin-sort-imports@6.0.2`, `husky@9.1.7`, `lint-staged@17.0.2` (root `package.json`).
2. `bunx husky init` — created `.husky/` and added `prepare` script.
3. Wrote `prettier.config.js` with the agreed config (printWidth 120, tabWidth 2, semi true, singleQuote false, trailingComma "all", arrowParens "always", endOfLine "lf"; sort-imports plugin with `^node:` → third-party → `^@repel/` → relative).
4. Wrote `.prettierignore` (lockfiles, dist/, node_modules/, .devctl_generated/, .devctl-worktrees/).
5. Set `.husky/pre-commit` to `bunx lint-staged`.
6. Added `format`, `format:check` scripts and `lint-staged` block (`*.{ts,tsx,md,json,yml,yaml}` → `prettier --write`) to root `package.json`.
7. Wrote `.claude/settings.json` PostToolUse hook: `Edit|Write|MultiEdit` matcher → `jq -r '.tool_input.file_path // empty' | xargs -I {} bunx prettier --write --ignore-unknown {}`. Verified live during the session — Prettier reformatted `tsconfig.json` after an edit.
8. Ran sed rewrite `.js` → `.ts` on relative source imports across `apps/**` and `packages/**` `.ts`/`.tsx` files. 53 occurrences across 27 files (ticket estimated 49/24 — minor drift, pre-existing).
9. Added `allowImportingTsExtensions: true` and `rewriteRelativeImportExtensions: true` to root `tsconfig.json` — required for `tsc --build` to accept `.ts`-extension imports while still emitting `dist/`.
10. Ran `prettier --write .` across the repo (formatting sweep).

## Decisions and deviations

### DR-REP-41-1 — tsconfig: `rewriteRelativeImportExtensions`

**Why:** Ticket asserted `.js` → `.ts` switch was safe under `moduleResolution: "bundler"` (true for Bun/Vite runtime), but didn't account for `tsc --build` emit. Default TS rejects `.ts` extensions in imports without `allowImportingTsExtensions: true`, which historically required `noEmit: true` — incompatible with this project's `tsc --build`-driven dist emit. TS 5.7+ added `rewriteRelativeImportExtensions: true` which lets source use `.ts` imports AND emit, by rewriting them to `.js` in `dist/`.

**How to apply:** Project is on TS 5.9.3 — supported. Both flags now in root tsconfig and inherited by all packages.

### Pipeline deviation

User-approved: skipped `qa-engineer → backend-engineer → code-reviewer` pipeline. This ticket is tooling/config + a mechanical sed rewrite + a repo-wide formatter sweep — no production logic to unit-test. ACs are verification commands, executed directly as gates after each phase.

### Pre-commit hook live-tested via the implementation commit itself

The first attempt to commit this work fired the husky pre-commit hook, which ran `bunx lint-staged` on 76 staged files and produced `[STARTED] prettier --write / [COMPLETED]` output before the commit landed. That exercises the full hook chain end-to-end on real staged content. AC PASS.

## Files changed

- **New:** `prettier.config.js`, `.prettierignore`, `.husky/pre-commit`, `.husky/_/**` (husky internals), `.claude/settings.json`, `docs/summaries/handoff-2026-05-07-REP-41-execute.md`
- **Modified:** `package.json`, `bun.lock`, `tsconfig.json`, plus 75 files reformatted by `prettier --write` across `apps/`, `packages/`, `docs/`, `README.md` (mostly markdown line-wraps and TS source quote/comma normalization). 49+ `.ts`/`.tsx` files also had relative `.js` imports rewritten to `.ts`.

## Verification (gate results)

| AC                                                                | Command                                                                          | Result       |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------ |
| Deps in devDependencies                                           | `package.json` inspection                                                        | PASS         |
| `prettier.config.js`                                              | exists, matches spec                                                             | PASS         |
| `.prettierignore`                                                 | exists, matches spec                                                             | PASS         |
| `.husky/pre-commit` runs `bunx lint-staged`                       | inspection                                                                       | PASS         |
| `format`, `format:check`, `prepare` scripts + `lint-staged` block | inspection                                                                       | PASS         |
| `.claude/settings.json` PostToolUse hook                          | inspection + live observation                                                    | PASS         |
| No `.js` source imports                                           | `grep -rn "from '\.[^']*\.js'" apps packages --include='*.ts' --include='*.tsx'` | PASS (empty) |
| `bun run format:check` exits 0                                    | `prettier --check .`                                                             | PASS         |
| `bun run typecheck`                                               | `tsc --build --clean && tsc --build`                                             | PASS         |
| `bun test`                                                        | 72 pass / 0 fail / 12 files                                                      | PASS         |
| `bun run build`                                                   | `tsc --build && vite build`                                                      | PASS         |
| Claude edit auto-formats                                          | observed in session                                                              | PASS         |
| Pre-commit reformats staged file                                  | observed during implementation commit (lint-staged ran prettier across 76 files) | PASS         |

## Open items

- **OPEN:** Wire `format:check` into CI — explicitly out of scope per ticket; follow-up ticket recommended.
- **OPEN:** `.devctl_generated/` and `.claude/skills/TypeScript/` were absolute-path symlinks pointing into `/Users/kylemuldoon/Developer/Repel/...` (devctl worktree machinery). Added to `.gitignore` so they no longer show as untracked or get committed accidentally.

## Next action

Squash branch commits to one `[REP-41] …` commit, push, open PR.
