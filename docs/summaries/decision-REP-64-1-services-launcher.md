# DR-REP-64-1: `cli services run` launcher, `RunnableApp` contract, `type:cli` boundary, and pool ownership

**Ticket:** REP-64 ([CLI] `cli services run [--all]` launcher + `type:cli` tag + app `start()` exports) — under REP-60 phase 4.

**Decision:** Add a privileged `type:cli` launcher that boots apps in-process by importing their `./start` export and calling a uniform `RunnableApp.start()`. Implements ADR-016 (app as deploy unit, cli as privileged launcher) and amends ADR-015 (apps expose exactly one public surface, `./start`).

## What was implemented

- **`packages/backend/libs/runtime`** (`@repel/backend-runtime`, tags `type:lib, scope:backend, boundary:app-runtime`). Exports `./application` = `interface RunnableApp { start(): Promise<void>; stop?(): Promise<void> }`. No other code; `libs/env` was **not** folded in (see Decision 4).
- **api `./start`** — `apps/api/src/main.ts` exports `apiApp: RunnableApp = { start: startApi }` **and** is a direct entrypoint: an `import.meta.main` guard boots the api when the file is run directly (`bun run .../api/src/main.ts`) but stays inert when the cli imports it (import.meta.main is false on import). So one file is both the public `./start` export and the raw entrypoint. `startApi()` was already resolve-when-ready (resolves in the Express `listen()` callback), so no body change. `api/package.json` — `exports: { "./start": "./src/main.ts" }` + a `@repel/backend-runtime` dep. `docker-compose` runs `main.ts` directly; `cli services run api` is the alternative launch path. **Why dual-role:** keep the raw entrypoint so production isn't forced through the cli — if cli-launch proves not worth it, `cli services run` can stay a dev convenience while Compose runs `main.ts` directly.
- **`apps/cli/src/services/`** — `schemas/` (zod, exactly-one-of `<name>`/`--all`), `registry.ts` (name → lazy `() => import('@repel/backend-*/start')`), `handler.ts`, `error.ts`. Registered in `index.ts`. cli retagged `type:app` → **`type:cli`**; gains `@repel/backend-api` + `@repel/backend-runtime` deps.
- **eslint boundaries** — added `{ type:cli → [type:lib, type:app] }`; extended `type:lib`'s `notDependOnLibsWithTags` to `['type:app', 'type:cli', 'boundary:app-runtime']`. `type:app → [type:lib]` unchanged.
- **`bin/cli-debug.ts`** — kept (user relies on the Chrome auto-open of the inspector URL); added a comment marking `bin/` the deliberate debug-ergonomics seam. Debug the launcher via `bun run cli:debug services run --all`.

## Decision 1 — `start()` is resolve-when-ready, not run-to-completion

`start()` resolves once the service's keep-alive handle is installed (api: the listener), **not** when its work finishes. The handle keeps the event loop alive after the promise settles, so the process stays up; the resolved promise is the launcher's ready barrier (`await Promise.all(starts)` → "all ready").

**Why:** uniform across an Express server and a future queue consumer (the consumer resolves once its poll loop is established, then keeps claiming). Gives `--all` a clean ready barrier and real stacks on boot failure (a rejected `start()` surfaces at the await). The never-resolve model only models cancellation — which is `stop?()`'s job (REP-58) — and would add race/probe machinery with worse boot-failure stacks for zero gain in-process.

## Decision 2 — `stop?()` optional and unimplemented this ticket

The contract reserves `stop?(): Promise<void>` but nobody implements it. Graceful drain-on-shutdown is explicitly REP-58's (consumer-runtime) scope. A required `stop()` would force capturing + closing the `http.Server` in `startApi()` now, for a path no caller exercises in this ticket — hollow, untested shutdown code. The optional slot lets REP-57/58 fill it without amending the interface or any caller.

## Decision 3 — the launcher owns DB-pool shutdown; no guard needed

The DB pool is a **process-level singleton** (`libs/db` `getDb()` memoizes one pg `Pool` per process; every importer shares it). In `--all` (one process) one pool serves every service — which matches prod (one container per app → one singleton each), keeps RLS isolation per-transaction (`SET LOCAL app.current_org_id`, not per-pool), and is more debuggable than N pools.

The hazard: `cli/src/index.ts` closes the pool in an **unconditional** `.finally(closeDb)` after `parseAsync()` resolves — correct for short-lived verbs, fatal for a long-running `services run` (closing the shared pool out from under still-running services). **Resolution without a guard:** `runServicesRun` awaits a never-resolving shutdown promise, so `parseAsync` stays pending and the `.finally` does not fire while services run. On `SIGINT`/`SIGTERM` the handler closes the pool and `process.exit(0)`s itself. The `.finally(closeDb)` therefore runs for `services run` **only if boot fails** (parseAsync rejects) — which is the correct time to close. The blocking await _is_ the guard; documented in `index.ts`.

## Decision 4 — `env` stays in `libs/env`; not folded into `runtime`

Considered moving `libs/env` under `runtime`. Rejected: `env` is a broadly-imported leaf util (`db`, `crypto`, every verb, api), whereas `RunnableApp` is app-only. Decisively, `runtime` carries `boundary:app-runtime` which **forbids any `type:lib` from importing it** — folding `env` in would break every lib that reads env. The two ideas are mutually exclusive; keeping them separate is required, not a preference.

## Decision 5 — the web SPA is not a service (Option A deferred)

`vite build` emits static assets — not a process, no `start()`, no `RunnableApp`, no registry entry. Future serving is **Option A**: the api Express app serves the built `dist/` via `express.static(WEB_DIST_DIR)` (env-addressed, no `import '@repel/web'`, so no `scope:backend → scope:frontend` module-graph edge — boundary holds). Out of scope here; filed as a follow-up.

## Verification

- `bun run build` / `lint` / `test` clean from a reset cache (171 tests, +13 new for services schema/handler/registry). `nx sync:check` clean.
- Boundary matrix (manual, reverted): `type:lib → type:app/start` **fails**; `type:lib → boundary:app-runtime` **fails**; an app importing another app's resolvable `./start` **fails**; the real `type:cli → type:app` (cli imports api/start) **passes**. No committed violation test (no harness exists; the rule lives in `nx lint`).
- Runtime smoke: `services run api` logs `starting`/`ready (Nms)`/`all ready` and writes `[{"service":"api","status":"ready","elapsedMs":N}]` (all on stdout — see logging note below), one PID, `/health` → `{ ok: true }`, `SIGTERM` → clean launcher-owned shutdown.

## Open items (not Linear tickets yet)

- **Logging channels:** per PR #32 review, the prior stdout-vs-stderr split for CLI handlers was abandoned in favour of console semantics: `console.log` for status, `console.warn` for cautions (e.g. the `db encryption generate-key` unrecoverable-key warning), `console.error` for genuine errors. Applied repo-wide across the cli handlers, not just the new `services` code. The one exception is structured machine-readable output (the `services run` summary, `accounts list`, `db query`, …), which uses `process.stdout.write(JSON.stringify(...) + '\n')` for exact-byte output — the established idiom, kept distinct from `console.log` status chatter. The api's own `console.log('API listening …')` therefore sits alongside the launcher's status lines.

## Compliance

ADR-016 (app deploy unit; cli privileged launcher; `type:cli → type:app` the one licensed app-import), ADR-015 (apps expose only `./start`), ADR-012 (verb handler + sibling `schemas/`). Manifesto §5 Rule 8 boundary table (`type:cli` row). Complies with the REP-63 DR's sync-plugin reality (per-project `tsconfig` references validated by `nx sync:check`; root references hand-maintained).
