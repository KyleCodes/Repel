# Critiques of Vertical Slice Architecture

No single canonical source — this is a counterweight entry collecting the recurring objections so you don't adopt vertical slices uncritically.

**Recurring criticisms:**

1. **Duplication across slices.** Two slices that both need "load org with active provider accounts" will each write their own query. Real cost; the vertical-slice answer ("extract a query function when you've copied it three times") is fine but requires discipline.
2. **No place for cross-cutting invariants.** "An org always has at least one admin user" lives nowhere obvious — every slice that deletes users has to remember the rule. The DDD aggregate concept exists specifically to give such rules a home.
3. **Business logic ends up in SQL.** Hard to unit-test, harder to port. The flow style pushes logic toward the database; the layered style pushes it toward the application. Both have real costs.
4. **Read/write asymmetry can fragment the mental model.** New engineers have to learn N use cases instead of M entities; for a domain with stable entities and many operations, entity-folders genuinely scale better.

**Counter-sources worth reading:**

- Vaughn Vernon, _Implementing Domain-Driven Design_ (2013) — the strongest modern case for aggregates as the unit of consistency. ISBN 978-0-321-83457-7.
- Eric Evans, _Domain-Driven Design_ (already in this list) — chapters on aggregates and bounded contexts.
- Search terms that surface the debate: "vertical slice architecture criticism", "transaction script vs domain model", "anemic domain model" (Fowler: https://martinfowler.com/bliki/AnemicDomainModel.html).
- Fowler's _AnemicDomainModel_ bliki entry is the standard objection to "service does everything, entities are just data bags" — which is what flow/transaction-script designs slide into if undisciplined.

Use this entry as a check before committing fully. The honest answer for most small apps is hybrid: vertical slices for use cases, with a small number of aggregate-shaped invariant guards where the domain genuinely demands them.
