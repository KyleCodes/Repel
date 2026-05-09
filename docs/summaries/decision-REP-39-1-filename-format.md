# DR-REP-39-1: Migration filename format

**Ticket:** REP-39 (T2 — Migrate + status)

**Decision:** Migration filenames are `<unix-ms>_<rep-NN>.ts` (e.g., `1714838422000_rep-19.ts`). The slug is the ticket ID extracted from the current git branch via regex `rep-\d+` (case-insensitive). When `db migrate create` is invoked without a `name` arg, the slug is derived from the branch automatically.

**Why:**

- Unix-ms timestamp prefix is node-pg-migrate's native default and unlocks the timestamp-range targeting on `up`/`down` (see DR-REP-39-4).
- Sortable, monotonic, no merge conflicts when two branches add migrations concurrently — unlike sequential indices (`0001`, `0002`).
- Ticket-slug-only (no free-text) keeps filenames short and tightly coupled to the planning artifact (Linear ticket). Provenance is preserved in the docstring header (DR-REP-39-3) which carries the full branch name.
- Rejected alternative: content hash (git-commit-style). Not native to node-pg-migrate; not sortable by creation order; harder to reason about migration order.
- Rejected alternative: include free-text name in filename. Verbose; ticket ID is a stable handle that already maps to a description.

**Satisfies AC:**

- "db migrate create [name] generates <unix-ms>\_<rep-NN>.ts in apps/server/src/db/migrations/."
- "Default name derived from current branch via extractTicketSlug. Errors with a clear message if branch yields no rep-\\d+ and no name was passed."
