# ADR-004: Postgres-Backed Job Queue

**Date:** 2026-01-01 (amended 2026-06-20 REP-60 phase 4)
**Status:** ACCEPTED
**Domain:** data-storage, infrastructure

## Context

Asynchronous work (sync runs, and later classify/summarize/draft) runs against ingested messages. A queue is needed to decouple the trigger from the processing, provide retry semantics, and prevent lost work. Options evaluated: in-memory array, BullMQ + Redis, RabbitMQ, Postgres-backed queue.

## Decision

Use a single `job_queue` table in PostgreSQL with `FOR UPDATE SKIP LOCKED` for dequeue, fronted by one backend lib, `libs/queue` (`@repel/backend-queue`), that exposes `enqueue(topic, payload)` / `consume(topic, handler)`.

- **One table, a `topic` column.** Logical queues are distinguished by a `topic` column on the one `job_queue` table, not by a table per topic. This matches what the mature Postgres-queue libraries do — graphile-worker and River both key off a name/queue column on one table, and pg-boss reverted _automatic_ per-queue partition tables in v11 after thousands of tables caused connection-pooler pressure. Per-queue partitioning stays available as a later, opt-in choice for a single high-volume topic; it is not the starting shape.
- **`topic` is the swap seam.** `topic` is a plain string in the `enqueue`/`consume` surface; the fact that it is stored as a column is internal to the transport. Nothing outside `libs/queue` knows the queue is Postgres, so migrating to pg-boss, RabbitMQ, Kafka, or a managed service is a change inside `libs/queue` and never touches a handler.

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

- RISK: Postgres polling becomes a bottleneck at high job volume | MITIGATION: At personal email volume this is negligible; if needed, migrate by swapping the transport inside `libs/queue` (e.g. to BullMQ + Redis), with no change to handlers or the `enqueue`/`consume` surface
- RISK: A hot single `job_queue` table accumulates dead tuples / autovacuum lag under sustained load | MITIGATION: Tune autovacuum per-table; partition by time and drop old partitions; opt a single high-volume topic into its own partition. Topology (one table vs per-topic) is internal to `libs/queue` and can change without touching callers

## Compliance

- MUST: Enqueue jobs in the same transaction as the triggering insert
- MUST: Use `FOR UPDATE SKIP LOCKED` for dequeue to prevent double-processing
- MUST: Logical queues are a `topic` column on the one `job_queue` table, not a table per topic (per-topic partitioning is opt-in, not default)
- MUST: Only `libs/queue` reads or writes `job_queue` directly; callers use `enqueue`/`consume`
- MUST NOT: Use an in-memory queue or external queue service without a new ADR

## Review Trigger

Job throughput exceeds hundreds per second, or scheduling precision below 1 second becomes a requirement, or one topic's volume justifies its own partition.

## Related

- SUPERSEDES: NONE
- RELATED TO: ADR-001, ADR-003, ADR-016
- AMENDED BY: REP-60 phase 4 (the queue is the `libs/queue` lib; one `job_queue` table with a `topic` column; `topic`/`enqueue`/`consume` is the swap seam)
- REFERENCED BY: NONE
