# ADR-004: Postgres-Backed Job Queue

**Date:** 2026-01-01
**Status:** ACCEPTED
**Domain:** data-storage, infrastructure

## Context

The processing pipeline (classify, summarize, draft) runs asynchronously against ingested messages. A queue is needed to decouple ingestion from processing, provide retry semantics, and prevent lost work. Options evaluated: in-memory array, BullMQ + Redis, RabbitMQ, Postgres-backed queue.

## Decision

Use a `job_queue` table in PostgreSQL with `FOR UPDATE SKIP LOCKED` for dequeue operations.

## Alternatives Considered

| Option          | Reason Rejected                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------------- |
| In-memory queue | Lost on process restart; no retry semantics                                                        |
| BullMQ + Redis  | Adds Redis as a new infrastructure dependency with no operational benefit at personal email volume |
| RabbitMQ        | Same objection as Redis, plus more operational complexity                                          |

## Consequences

### Positive

- No additional infrastructure dependencies
- Job enqueue in the same transaction as message insert — no message ingested without a corresponding job
- `scheduled_for`, `attempts`, `max_attempts`, `last_error` columns provide retry and dead-letter semantics out of the box

### Negative / Trade-offs

- Polling interval introduces a latency floor (default 1 second)
- No built-in priority queues, rate limiting, or advanced routing

### Risks

- RISK: Postgres polling becomes a bottleneck at high job volume | MITIGATION: At personal email volume this is negligible; if needed, migrate to BullMQ by swapping `queue.ts` and adding Redis

## Compliance

- MUST: Enqueue jobs in the same transaction as the triggering insert
- MUST: Use `FOR UPDATE SKIP LOCKED` for dequeue to prevent double-processing
- MUST NOT: Use an in-memory queue or external queue service without a new ADR

## Review Trigger

Job throughput exceeds hundreds per second, or scheduling precision below 1 second becomes a requirement.

## Related

- SUPERSEDES: NONE
- RELATED TO: ADR-001, ADR-003
- REFERENCED BY: NONE
