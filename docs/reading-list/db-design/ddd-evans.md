# Domain-Driven Design — Eric Evans (2003)

**Book.** ISBN 0-321-12521-5.

Origin of "bounded context", "aggregate", "repository", "ubiquitous language". Read for the _bounded context_ and _aggregate_ concepts — they're the strongest argument _for_ keeping some entity-shaped structure. An aggregate is a consistency boundary: the cluster of objects that must be modified together under one transaction. If your invariants genuinely span multiple tables (e.g. "an org always has at least one admin user"), the aggregate concept tells you those tables belong to the same write boundary.

The book's "repository" is _not_ one-per-table — it's one-per-aggregate-root, returning the whole consistency cluster. Most modern repository code (yours included) misuses the term.

Heavy book. The Vaughn Vernon distillations (_Implementing DDD_, _Domain-Driven Design Distilled_) are more digestible. Eric Evans' free 100-page summary PDF from InfoQ is the fastest way in: https://www.infoq.com/minibooks/domain-driven-design-quickly/
