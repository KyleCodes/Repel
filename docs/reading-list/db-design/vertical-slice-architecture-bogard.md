# Vertical Slice Architecture — Jimmy Bogard

**URL:** https://www.jimmybogard.com/vertical-slice-architecture/

The most-cited modern writeup of feature-folder organization. Bogard argues that the unit of organization should be the _use case_ (CreateOrder, ApproveInvoice), not the entity. Each slice owns its own request/response shape, validation, persistence calls, and SQL — and is explicitly allowed to be inconsistent with sibling slices. The payoff: changes to one feature touch one folder; you stop dragging shared "service layers" and "repository interfaces" into every change.

Direct counter to the entity-per-folder layout (`core/org`, `core/user`, ...) — and the reason `accountSetupService` feels awkward is that "bootstrap an account" is a slice, not a composition of two entity services.

Pair with Bogard's MediatR work for the C# flavor; the pattern translates cleanly to TS without the mediator.
