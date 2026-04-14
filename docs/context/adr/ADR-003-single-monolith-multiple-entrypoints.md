# ADR-003: Single Monolith, Multiple Entrypoints
**Date:** 2026-01-01
**Status:** ACCEPTED
**Domain:** deployment, architecture

## Context
The application has three runtime concerns: HTTP API, background worker (job processing), and sync scheduler (polling email providers). The developer is a sole operator deploying to a single bare-metal server.

## Decision
A single TypeScript codebase with a single build artifact. Runtime mode is selected via a `MODE` environment variable (`all` | `api` | `worker` | `sync`). A separate `cli.ts` entrypoint provides non-HTTP access to the same operations.

## Alternatives Considered
| Option | Reason Rejected |
|--------|----------------|
| Separate services | No operational benefit at this scale; adds Dockerfiles, health checks, and inter-service communication overhead |
| Next.js API routes co-located with frontend | Couples frontend and backend build; adds SSR complexity not needed for a thick-client SPA |

## Consequences

### Positive
- Zero inter-service communication (same process, in-process calls)
- Single log stream, single debugger session
- Worker can be extracted to a separate process later with zero code changes (run second instance with `MODE=worker`)

### Negative / Trade-offs
- A crash in the worker crashes the API
- Unused code loaded when running in a single-component mode

### Risks
- RISK: Worker CPU load (LLM calls) starves API request handling | MITIGATION: Run separate instances with `MODE=api` and `MODE=worker` if this materialises

## Compliance
- MUST: Components communicate through the job queue table, not through direct in-process function calls that bypass the queue
- MUST NOT: Add a new runtime dependency (Redis, RabbitMQ) without a new ADR
- SHOULD: Keep API, worker, and sync as independent modules that share only `db/` and `domains/`

## Review Trigger
Worker CPU load demonstrably impacts API latency, or the application requires independent scaling of components.

## Related
- SUPERSEDES: NONE
- RELATED TO: ADR-004
- REFERENCED BY: NONE
