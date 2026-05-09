# ADR-007: LLM Executor as a Shared Lib

**Date:** 2026-01-01
**Status:** ACCEPTED
**Domain:** architecture, ai-pipeline

## Context

Multiple features require LLM calls: classification pipeline (async, queued), automation workflows (async, queued), and the chat interface (sync, request-response). These features have different execution contexts but identical LLM mechanics — build a prompt, call an API, parse the response.

## Decision

The LLM executor is a stateless function in `src/lib/llm.ts` that takes a prompt and configuration and returns a response. Retry, streaming, and lifecycle management are caller concerns.

## Alternatives Considered

| Option                             | Reason Rejected                                                                                                                           |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| LLM executor as a separate service | Forces all callers through the same execution path; chat needs streaming, pipeline needs retries — incompatible via one service interface |
| Queue-specific LLM worker          | Prevents the chat interface from using the executor directly                                                                              |

## Consequences

### Positive

- One executor; callers compose their own lifecycle management around it
- Rate limiting and cost tracking can be added as middleware inside the function without changing callers
- No additional infrastructure

### Negative / Trade-offs

- Each caller implements its own retry/timeout/error handling
- Model selection and API keys configured via env vars; no ambient runtime configuration

### Risks

- RISK: Callers implement divergent retry logic causing inconsistent LLM behavior | MITIGATION: Provide a shared `pipeline/lib/retry.ts` utility that callers import

## Compliance

- MUST: All LLM calls go through `src/lib/llm.ts`
- MUST NOT: Call LLM provider APIs directly from domain services or route handlers
- SHOULD: Caller-specific retry logic import from a shared retry utility rather than re-implementing

## Review Trigger

LLM calls require centralized rate limiting per org, or the number of LLM callers grows large enough that scattered retry logic becomes a maintenance problem.

## Related

- SUPERSEDES: NONE
- RELATED TO: ADR-003, ADR-004
- REFERENCED BY: NONE
