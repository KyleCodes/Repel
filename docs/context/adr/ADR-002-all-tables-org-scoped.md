# ADR-002: All Tables Are Org-Scoped with RLS

**Date:** 2026-01-01
**Status:** ACCEPTED
**Domain:** data-storage, multi-tenancy

## Context

The application is multi-tenant (B2C as single-user orgs, B2B as multi-user orgs). Data isolation between tenants must be enforced reliably as the codebase grows and new queries are added. Application-layer `WHERE org_id = $1` clauses are error-prone.

## Decision

Denormalize `org_id` onto every table that is directly queried from the API or processing layer, and enforce tenant isolation via PostgreSQL RLS policies filtering on `app.current_org_id`.

## Alternatives Considered

| Option                                | Reason Rejected                                                                        |
| ------------------------------------- | -------------------------------------------------------------------------------------- |
| Application-layer `WHERE org_id` only | Relies on developer discipline; one forgotten clause leaks cross-tenant data           |
| Composite PKs including `org_id`      | Complicates every FK reference, widens joins, provides no additional safety beyond RLS |
| Separate schemas per tenant           | Operational complexity at scale; incompatible with a single connection pool            |

## Consequences

### Positive

- RLS provides defense-in-depth; a missing `WHERE` clause cannot leak data
- Simple single-column `USING` clause on every policy
- `org_id` on every table enables efficient index scans without joins for tenant filtering

### Negative / Trade-offs

- Every connection must set `app.current_org_id` before executing queries
- 16 bytes per row on every table (negligible at personal email volume)
- New tables require both the `org_id` column and a corresponding RLS policy

### Risks

- RISK: Bootstrap or migration scripts run without `app.current_org_id` set and violate RLS | MITIGATION: Bootstrap runs under a BYPASSRLS role (see ADR-010 for the decorator that owns `SET LOCAL`); `runInOrgTx` enforces `SET LOCAL` for all runtime queries

## Compliance

- MUST: Every table queryable from the API or processing layer MUST include `org_id`
- MUST: Every such table MUST have a `tenant_isolation` RLS policy using `org_id = current_setting('app.current_org_id')::uuid`
- MUST: All tenant-scoped runtime queries MUST go through `runInOrgTx` (see ADR-010)
- MUST NOT: Set `app.current_org_id` via `SET` (session-scoped) — always use `SET LOCAL` (transaction-scoped)
- SHOULD: New migration files include RLS policy creation alongside `CREATE TABLE`

## Review Trigger

Application adopts a separate "app role" that genuinely respects RLS in production, at which point the bootstrap BYPASSRLS assumption needs to be documented or replaced.

## Related

- SUPERSEDES: NONE
- RELATED TO: ADR-001, ADR-009
- REFERENCED BY: NONE
