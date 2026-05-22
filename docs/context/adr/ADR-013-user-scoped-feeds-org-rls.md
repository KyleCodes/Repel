# ADR-013: User-Scoped Feeds — Org-Only RLS Now, User Dimension Denormalized

**Date:** 2026-05-21
**Status:** ACCEPTED
**Domain:** data-storage, multi-tenancy, data-access

## Context

ADR-002 established that every table is org-scoped and tenant isolation is enforced by RLS on `app.current_org_id`. It did not address the dimension _within_ an org: a B2B org has multiple users, and each user connects their own `provider_account` credentials and has their own per-user message feed. The product requirement is that a regular user sees only their own feeds while an org admin sees all of them — a per-user, role-conditional access rule that org-only RLS cannot express. The application is B2C-first (one user per org), so this distinction is currently unobservable, but the schema decisions made now determine whether user-level enforcement is a cheap addition or an expensive migration later. The trigger is the REP-16 CLI work (`account` verbs, sync) and the need to settle the `message`/`thread`/`provider_account` ownership model before that code is written.

## Decision

Keep RLS **org-scoped only** for now; model the user dimension in the schema today by **denormalizing `user_id` onto `message` and `thread`** (mirroring the existing `org_id` denormalization), and enforce per-user feed visibility through **`WHERE user_id = ?` clauses in view queries** rather than RLS. User-scoped RLS is deferred as a flat-cost future change. The `user` table stays org-bound — no identity/membership split.

## Alternatives Considered

| Option                                                                                                          | Reason Rejected                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add user-scoped RLS now (composite `org_id + user_id/role` policies)                                            | Premature for a B2C-first app where one user per org makes user-scoping unobservable; requires user-session plumbing (`SET LOCAL app.current_user_id/role`) exercised by nobody for months. Deferrable at zero penalty (see Consequences).                                |
| Leave `message`/`thread` without `user_id`; reach the user via `provider_account_id → provider_account.user_id` | Forces a join on every per-user query and a correlated subquery in every future user-RLS `USING` clause, evaluated per row on the highest-volume table. Also requires a backfill once the tables hold data — far more costly than adding the column while they are empty. |
| Split `user` into `identity` (the human) + `membership` (a seat in one org) now                                 | A structural migration that re-points live FKs; only needed for cross-org single-human queries, which the product (an org switcher = N independent single-org sessions) does not require. Deferred with a documented trigger.                                             |
| A `user_provider_account` join table (many-to-many)                                                             | Models sharing of one provider account by many users — explicitly not wanted; each user connects their own credentials. The existing `provider_account.user_id` FK correctly models one-owner-per-account.                                                                |

## Consequences

### Positive

- `message`, `thread`, and `provider_account` all carry their full `(org_id, user_id)` ownership as indexable columns — consistent with how `org_id` is already denormalized (ADR-002).
- Future user-scoped RLS becomes a pure `ALTER POLICY` against indexable columns plus two extra `SET LOCAL`s in the `runInOrgTx` decorator — no data backfill, no subqueries. The cost of hardening is flat regardless of when it happens.
- The schema change is free now: `message` and `thread` are empty, so `user_id NOT NULL` is a trivial migration.
- B2C-first runway is not spent building B2B user-session plumbing nobody exercises.

### Negative / Trade-offs

- Per-user feed isolation is currently enforced only by application-layer `WHERE` clauses — a forgotten clause leaks one user's feed to another within the same org. Org isolation remains RLS-enforced; only the user dimension relies on developer discipline until hardening lands.
- `message.user_id` and `thread.user_id` are denormalized copies of `provider_account.user_id`. Acceptable: the value is immutable (a row's owning provider account never changes) and is in scope at insert time, so no update-drift hazard — but the write path MUST populate it.
- 16 bytes + an index per row on `message`/`thread` (negligible at personal email volume — same trade-off ADR-002 already accepted for `org_id`).

### Risks

- RISK: An application view forgets the `WHERE user_id = ?` clause and leaks a feed across users in a multi-user org | MITIGATION: B2C-first means no multi-user orgs exist yet; hardening to user-RLS (below) makes a missing clause non-leaking, as ADR-002 does for `org_id`.
- RISK: The sync write path inserts a `message`/`thread` without setting `user_id`, or sets it inconsistently with `provider_account.user_id` | MITIGATION: `user_id NOT NULL` makes a missing value a hard insert failure; the write path always holds the `provider_account` being synced, so the correct value is in hand.
- RISK: A future cross-org need for a single human (a "portal" to manage one person's provider-account grants across orgs) forces the `user` identity/membership split after data has accumulated | MITIGATION: documented Review Trigger; until then no code may treat `user_id` as a cross-org human identifier.

## Compliance

- MUST: `message` and `thread` include a `user_id uuid NOT NULL REFERENCES "user"(id)` column, denormalized from `provider_account.user_id`, in addition to the `org_id` required by ADR-002.
- MUST: The write path that inserts `message`/`thread` rows populates `user_id` from the `provider_account` being synced.
- MUST: Per-user feed reads filter on `user_id` in the view query (`WHERE user_id = ?`) until user-scoped RLS exists.
- MUST NOT: Treat `user_id` (on any table) as a stable cross-org identifier for a human; it identifies a membership / seat in exactly one org.
- MUST NOT: Add a `user_provider_account` join table — one provider account has exactly one owning user.
- SHOULD: When user-scoped RLS is introduced, do it by extending the per-table `tenant_isolation` policy to a composite predicate (`org_id = current_setting('app.current_org_id')::uuid AND (current_setting('app.current_user_role') = 'admin' OR user_id = current_setting('app.current_user_id')::uuid)`) and adding the corresponding `SET LOCAL`s to the transaction decorator — selectively, per table (`provider_account`, `message`, `thread` get it; `org`, `contact` may stay org-only).

## Review Trigger

Revisit this ADR if any of the following occur:

- A decision to harden user isolation to the database layer — at which point the user-scoped RLS path in Compliance/SHOULD is implemented.
- A real need to query or manage one human's data across multiple orgs (a cross-org portal) — at which point the `user` identity/membership split must be designed.
- The first genuine multi-user org is provisioned — at which point the application-layer `WHERE user_id` enforcement should be audited before relying on it.

## Related

- SUPERSEDES: NONE
- RELATED TO: ADR-002 (org-scoped RLS — this ADR extends it with the user dimension), ADR-005 (provider_account vocabulary — already permits multiple users per org sharing an upstream account), ADR-010 (the `runInOrgTx` decorator that would carry the user-session context)
- REFERENCED BY: REP-20
