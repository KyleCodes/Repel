# ADR-003: Single Monolith, Multiple Entrypoints

**Date:** 2026-01-01
**Status:** ACCEPTED
**Domain:** deployment, architecture

## Context

The application has three runtime concerns: HTTP API, background worker (job processing), and sync scheduler (polling email providers). The developer is a sole operator deploying to a single bare-metal server.

## Decision

A single TypeScript codebase whose runtime roles are separate **app packages** that share libraries. The principle is unchanged from the original ADR — one codebase, role chosen at launch, the worker extractable later with no code change — but the **mechanism** was amended by the REP-60 restructure (REP-61/62/63):

- **Original mechanism (superseded):** one build artifact; role selected at runtime via a `MODE` environment variable (`all | api | worker | sync`); a separate `cli.ts` entrypoint.
- **Current mechanism:** each role is its own app package under `packages/backend/apps/` — `@repel/backend-api` (`src/main.ts`), `@repel/backend-worker`, `@repel/backend-cli` (`src/index.ts`). The role is chosen by **which entrypoint a process runs**, not by an env var. There is no `MODE` switch and no combined `main.ts`. Apps are thin composers over the shared `libs/`; they are run, never imported (they expose no `exports` map). In development each runs directly under Bun (`bun run <app>/src/...`); there is no compile step. Multiple compiled artifacts (one per app, via `bun build --compile`) replace the single build artifact when staging/prod deploy is built out — deferred, not yet present.

## Alternatives Considered

| Option                                      | Reason Rejected                                                                                                 |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Separate services                           | No operational benefit at this scale; adds Dockerfiles, health checks, and inter-service communication overhead |
| Next.js API routes co-located with frontend | Couples frontend and backend build; adds SSR complexity not needed for a thick-client SPA                       |

## Consequences

### Positive

- Zero inter-service communication (same process, in-process calls)
- Single log stream, single debugger session
- Worker can be extracted to a separate process later with zero code changes (run the `@repel/backend-worker` entrypoint as its own instance)

### Negative / Trade-offs

- A crash in the worker crashes the API
- Unused code loaded when running in a single-component mode

### Risks

- RISK: Worker CPU load (LLM calls) starves API request handling | MITIGATION: Run the `@repel/backend-api` and `@repel/backend-worker` entrypoints as separate instances if this materialises

## Compliance

- MUST: Components communicate through the job queue table, not through direct in-process function calls that bypass the queue
- MUST NOT: Add a new runtime dependency (Redis, RabbitMQ) without a new ADR
- MUST NOT: Reintroduce a `MODE` env switch or a combined entrypoint; each role stays its own app package run by its own entrypoint
- SHOULD: Keep api, worker, and cli as thin app packages that share only `libs/` and `packages/shared/` — tag-enforced (`type:app → type:lib`, see manifesto §5 Rule 9)

## Review Trigger

Worker CPU load demonstrably impacts API latency, or the application requires independent scaling of components.

## Related

- SUPERSEDES: NONE
- RELATED TO: ADR-004, ADR-015 (exports map / module public contract)
- AMENDED BY: REP-63 (mechanism: per-app entrypoints replace `MODE`; per-app compiled artifacts later replace the single artifact)
- REFERENCED BY: NONE
