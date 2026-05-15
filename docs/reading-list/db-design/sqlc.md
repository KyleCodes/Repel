# sqlc — Compile SQL to Type-Safe Code

**URL:** https://sqlc.dev/ — Docs: https://docs.sqlc.dev/

sqlc inverts the usual ORM flow: you write `.sql` files containing real queries, sqlc parses them against the schema and generates typed query functions. The query is the unit of authorship; the "model" is whatever shape that specific query returns.

Worth reading even if you stay on Kysely, because the philosophy is the same one you're moving toward: stop thinking "what does the User entity look like?" and start thinking "what does the LoadInboxView query return?" Different queries return different shapes of the same table — and that's correct, not a smell to abstract away.

Kysely (your stack) sits in the same family — type-safe query builder rather than ORM — but sqlc's docs articulate the _why_ more crisply than Kysely's do.

Compare with: jOOQ (Java, same philosophy, older), HugSQL (Clojure), Diesel (Rust).
