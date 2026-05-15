# Patterns of Enterprise Application Architecture — Martin Fowler (2002)

**Book.** ISBN 0-321-12742-0.

The canonical catalog of the patterns you're walking away from: Repository, Data Mapper, Active Record, Unit of Work, Service Layer, Domain Model, Table Module. Read it not to adopt them but to understand _what they were solving_ — heterogeneous data sources, in-memory object graphs that survive multiple requests, ORM-mediated change tracking — and notice that most of those problems do not exist in a single-Postgres, stateless-handler app like yours.

Specifically relevant chapters:

- **Repository** (p. 322) — the pattern your `core/*/repo.ts` files are implementing. Fowler is explicit it's for mediating between the domain and _complex_ data access; one-table CRUD doesn't qualify.
- **Service Layer** (p. 133) — note Fowler's caveat that thin pass-through service layers are anti-value.
- **Domain Model vs. Transaction Script** (p. 110, p. 116) — Transaction Script is the honest name for "vertical slice with SQL inside it" and Fowler is not dismissive of it for simple domains.

Standard reference. Skim, don't read cover-to-cover.
