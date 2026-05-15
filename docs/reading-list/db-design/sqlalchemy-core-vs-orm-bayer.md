# SQLAlchemy: Core vs. ORM — Mike Bayer

**Docs:** https://docs.sqlalchemy.org/en/20/tutorial/index.html
**Talk — "The SQLAlchemy Session — In Depth":** https://www.youtube.com/watch?v=t1A0lDGF1PQ

Mike Bayer authored SQLAlchemy and is unusually candid that the ORM layer is the wrong tool for many writes. SQLAlchemy ships with two layers: Core (Expression Language, a query builder over real SQL) and the ORM (unit-of-work, identity map, lazy loading). Bayer's docs and talks repeatedly steer users to Core for bulk writes, complex updates, and anything performance-sensitive — exactly the cases where the ORM's session/identity-map machinery generates N+1 queries or surprise round trips.

Relevance: the ORM author himself says "use the lower layer when the use case is shaped like a query, not an object graph." That's the bridge from your current pattern to a flow-based one.

Specifically read: the Core tutorial (just the first few sections) and the section "When do I construct a Session, when do I commit it, and when do I close it?" in the ORM docs — the FAQ entries are blunt about anti-patterns.
