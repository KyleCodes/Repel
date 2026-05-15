# Postgres: Writeable CTEs, RETURNING, ON CONFLICT, LATERAL

**Docs:**

- WITH / writeable CTEs: https://www.postgresql.org/docs/current/queries-with.html
- RETURNING: https://www.postgresql.org/docs/current/dml-returning.html
- INSERT ... ON CONFLICT: https://www.postgresql.org/docs/current/sql-insert.html#SQL-ON-CONFLICT
- LATERAL joins: https://www.postgresql.org/docs/current/queries-table-expressions.html#QUERIES-LATERAL

Not a single source — the four Postgres features you reach for once you stop splitting writes into per-table calls.

- **Writeable CTEs** let one statement perform multiple INSERT/UPDATE/DELETEs and pass IDs between them: `WITH new_org AS (INSERT INTO org ... RETURNING id) INSERT INTO "user" (org_id, ...) SELECT id, ... FROM new_org`. Replaces the round-trip pattern in your `accountSetupService`.
- **RETURNING** removes the "insert then SELECT to get the generated id/timestamp" round trip.
- **ON CONFLICT** turns "find-or-insert" from a 2-statement race into one atomic statement.
- **LATERAL** lets a join's right side reference the left — the SQL way to express "for each X, fetch top-N related Y" without N+1.

Read the docs pages directly; they're short and have runnable examples. Then read Markus Winand's modern-sql.com WITH chapter (https://modern-sql.com/feature/with) for the cross-vendor framing.
