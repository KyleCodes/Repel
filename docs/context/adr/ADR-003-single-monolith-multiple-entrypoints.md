# ADR-003: Single Monolith, Multiple Entrypoints

**Date:** 2026-01-01 (amended 2026-06-19 REP-63, 2026-06-20 REP-60 phase 4)
**Status:** ACCEPTED
**Domain:** deployment, architecture

## Context

The application has three runtime concerns: HTTP API, background worker (job processing), and sync scheduler (polling email providers). The developer is a sole operator deploying to a single bare-metal server.

## Decision

A single TypeScript codebase whose runtime roles are separate **app packages** that share libraries. The principle is unchanged from the original ADR — one codebase, role chosen at launch, the worker extractable later with no code change — but the **mechanism** was amended by the REP-60 restructure (REP-61/62/63):

- **Original mechanism (superseded):** one build artifact; role selected at runtime via a `MODE` environment variable (`all | api | worker | sync`); a separate `cli.ts` entrypoint.
- **Current mechanism:** each role is its own app package under `packages/backend/apps/` — `@repel/backend-api` (`src/main.ts`), `@repel/backend-sync-worker`, and others as stacks are added. The role is chosen by **which app a process runs**, not by an env var. There is no `MODE` switch, no combined `main.ts`, and no generic `worker` host (the former placeholder `@repel/backend-worker` was deleted; consumers are named per-stack apps such as `sync-worker`). An app owns its app logic (HTTP server, request parsing, consumer instantiation, handler bodies) and delegates to the shared `libs/`. An app exposes exactly one public entry, `./start` (its launch function), consumed only by the cli (see ADR-015); it is otherwise un-importable.
- **The launcher.** The cli (`@repel/backend-cli`, tagged `type:cli`, not `type:app`) is the launcher: `cli services run <name>` resolves config, renders env, and calls an app's `start()`; `cli services run --all` calls every app's `start()` in one process for a single-debugger end-to-end run. In development apps run directly under Bun (`bun run <app>/src/...`) or via the cli; there is no compile step. In production each app is its own container and Compose invokes `cli services run <name>` per service. Multiple compiled artifacts (one per app, via `bun build --compile`) replace per-app `bun run` when staging/prod deploy is built out — deferred, not yet present.

## Alternatives Considered

| Option                                      | Reason Rejected                                                                                                 |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Separate services                           | No operational benefit at this scale; adds Dockerfiles, health checks, and inter-service communication overhead |
| Next.js API routes co-located with frontend | Couples frontend and backend build; adds SSR complexity not needed for a thick-client SPA                       |

## Consequences

### Positive

- Zero inter-service communication (same process, in-process calls)
- Single log stream, single debugger session
- A consumer can be extracted to a separate process later with zero code changes (run its app, e.g. `@repel/backend-sync-worker`, as its own instance via `cli services run`)

### Negative / Trade-offs

- A crash in the worker crashes the API
- Unused code loaded when running in a single-component mode

### Risks

- RISK: Consumer CPU load (LLM calls) starves API request handling | MITIGATION: Run the `@repel/backend-api` and the consumer app (e.g. `@repel/backend-sync-worker`) as separate instances/containers if this materialises

## Compliance

- MUST: Components communicate through the job queue, not through direct in-process function calls that bypass the queue
- MUST NOT: Add a new runtime dependency (Redis, RabbitMQ) without a new ADR
- MUST NOT: Reintroduce a `MODE` env switch, a combined entrypoint, or a generic `worker` host; each runtime role stays its own named app run by `cli services run`
- MUST: Each app is its own deployable (one image / one container / one compose service); apps never import each other (`type:app ↛ type:app`)
- MUST: An app expose only `./start` publicly, consumed solely by the cli (`type:cli`); see ADR-015
- SHOULD: Keep apps as composition roots over `libs/` and `packages/shared/` — tag-enforced (`type:app → type:lib`; `type:cli → type:lib, type:app`, see manifesto §5 Rule 8)

## Review Trigger

Worker CPU load demonstrably impacts API latency, or the application requires independent scaling of components.

## Related

- SUPERSEDES: NONE
- RELATED TO: ADR-004, ADR-015 (exports map / module public contract), ADR-016 (app as deploy unit; CLI as privileged launcher; stack as folder)
- AMENDED BY: REP-63 (mechanism: per-app entrypoints replace `MODE`; per-app compiled artifacts later replace the single artifact); REP-60 phase 4 (generic `worker` host deleted → named per-stack apps; the cli is `type:cli` and launches apps via `cli services run`; apps expose `./start`)
- REFERENCED BY: NONE
