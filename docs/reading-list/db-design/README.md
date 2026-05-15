# DB Design Reading List

Sources for moving from entity-per-folder (DDB-shaped) backend layout toward use-case / "flow" oriented design that lets the SQL engine do the joining and writing in as few round trips as possible.

Grouped roughly:

1. **Vertical slices & feature folders** — organize by use case, not entity
2. **CQRS (lowercase)** — writes vs. reads have different shapes
3. **Functional core / boring architecture** — pushback on layered repo→service stacks
4. **SQL-as-authorship** — query builders/codegen treat the query as the unit
5. **ORM critique** — why the repository-per-table pattern degrades in SQL
6. **Postgres leverage** — CTEs, RETURNING, ON CONFLICT, LATERAL
7. **Counterweights** — aggregates, DDD, and critiques of vertical slices
