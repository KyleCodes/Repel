# ADR-001: PostgreSQL over NoSQL
**Date:** 2026-01-01
**Status:** ACCEPTED
**Domain:** data-storage

## Context
The application stores messages, threads, classifications, tags, contacts, and their relationships. Access patterns include joining messages with classifications and summaries, filtering by tag/category/account, and querying contacts across channels. The developer has recent DynamoDB experience and evaluated NoSQL as an option.

## Decision
Use PostgreSQL as the sole data store.

## Alternatives Considered
| Option | Reason Rejected |
|--------|----------------|
| DynamoDB | Relational data model requires either heavy denormalization or multiple GSIs per query pattern; every new access pattern requires a new index or schema change; no equivalent to RLS, SKIP LOCKED, or pgcrypto |
| Composite PK pattern (DynamoDB-style) | Complicates every FK reference, widens join conditions, adds no safety beyond what RLS provides |

## Consequences

### Positive
- Single dependency for data storage, queuing, and full-text search
- Row-level security for tenant isolation
- `FOR UPDATE SKIP LOCKED` for job queue (no Redis)
- `pgcrypto` for credential encryption, JSONB for polymorphic fields
- Schema migrations are mechanical for an evolving model

### Negative / Trade-offs
- Schema migrations required for structural changes
- Horizontal scaling requires Citus, read replicas, or migration away from Postgres if ever needed at high multi-tenant load (not a near-term concern)

### Risks
- RISK: Postgres becomes a bottleneck at high write volume | MITIGATION: Vertical scaling is sufficient at personal email volume; Citus is an upgrade path if needed

## Compliance
- MUST: Use Postgres for all persistent data (including queues)
- MUST NOT: Introduce a separate NoSQL or in-memory store without a new ADR
- SHOULD: Prefer normalized schema over denormalization unless there is a measured query performance reason

## Review Trigger
Application exceeds millions of messages per day across thousands of tenants, or a query pattern emerges that Postgres cannot serve efficiently.

## Related
- SUPERSEDES: NONE
- RELATED TO: ADR-002, ADR-004
- REFERENCED BY: NONE
