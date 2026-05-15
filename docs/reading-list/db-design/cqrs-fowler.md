# CQRS — Martin Fowler

**URL:** https://martinfowler.com/bliki/CQRS.html

Short bliki entry on Command Query Responsibility Segregation in its lowercase, non-event-sourced form: writes and reads have different shapes and should not share a model. Writes are use-case-shaped (one transaction, often one statement, return only what the caller needs). Reads are view-shaped (one query producing exactly the screen's payload, joining freely, denormalizing freely).

Important because it gives you permission to stop forcing reads through the same repository interface as writes. A `getInboxView(orgId)` query that does a 4-table join with aggregates is fine — it does not need to compose `userRepo.findById` + `threadRepo.list` + `messageRepo.countUnread`.

Read alongside Greg Young's CQRS material if you want the deeper version, but Fowler's page is enough to internalize the split.
