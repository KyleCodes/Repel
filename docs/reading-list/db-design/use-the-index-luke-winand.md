# Use The Index, Luke! / SQL Performance Explained — Markus Winand

**Site:** https://use-the-index-luke.com/
**Book:** _SQL Performance Explained_ (2012), ISBN 978-3-9503078-2-5

The standard reference for "what does the database actually do with this query." Free site covers index design, join algorithms, pagination, and the cost model in language a developer (not a DBA) can follow. The book is a compact paid version of the same material.

Relevance to flow-based design: once you start writing use-case-shaped queries (CTEs, joins, window functions), you need a working mental model of what the planner will do with them, otherwise the "fewer round trips" win evaporates into "one slow query." Winand teaches that mental model.

Start with: https://use-the-index-luke.com/sql/anatomy — the index anatomy chapter — and the "Slow Indexes" section. The pagination chapter is also disproportionately useful.

Companion site, same author, on modern SQL features (CTEs, window functions, MERGE): https://modern-sql.com/
