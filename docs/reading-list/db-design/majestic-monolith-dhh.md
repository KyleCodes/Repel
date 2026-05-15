# The Majestic Monolith — David Heinemeier Hansson

**URL:** https://signalvnoise.com/svn3/the-majestic-monolith/

DHH's pushback on premature decomposition — both microservices and over-layered "clean architecture" stacks. The piece is short and polemical; the relevant lesson for DB design is that Rails/Active Record's "fat model, skinny controller" plus direct ActiveRecord calls in controllers is _not_ an antipattern when the team is small and the schema is the source of truth. Layers exist to absorb churn at boundaries you actually have.

Read for the framing — "what problem is this layer solving for me right now?" — not as a license to skip every abstraction. If you have one engineer and one database, the repository-per-table indirection is paying rent on a problem you don't have.

Pair with his "Conceptual Compression" piece (https://m.signalvnoise.com/conceptual-compression-means-beginners-dont-need-to-know-sql-hallelujah/) for the opposite trade-off, which is useful as a contrast.
