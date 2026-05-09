# ADR-008: Client-Side SPA with TanStack Stack

**Date:** 2026-01-01
**Status:** ACCEPTED
**Domain:** frontend, architecture

## Context

The application needs a web frontend for viewing the message feed, managing accounts, reviewing draft replies, and chatting with the mailbox. The backend is a separate REST API. The frontend is accessed by a single user on a private network.

## Decision

Client-side rendered React SPA built with Vite. TanStack Router for routing. TanStack Query for all server data fetching. Zustand for minimal client-only global state. Plain HTTP REST — no GraphQL, no tRPC.

## Alternatives Considered

| Option       | Reason Rejected                                                                                                                                 |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Next.js      | Earns its keep with SSR/ISR/API routes — none of which this application needs; adds framework complexity and build-time overhead for no benefit |
| React Router | Less native integration with TanStack Query for route-level data loading; no type-safe route params                                             |
| tRPC         | Couples frontend build to backend codebase at type level; adds runtime framework over HTTP; `@repel/shared` already provides type safety        |
| GraphQL      | Access patterns are well-defined and resource-oriented; resolver complexity and tooling overhead not justified                                  |
| Redux        | Excessive boilerplate for the small amount of client-only global state this app has                                                             |

## Consequences

### Positive

- Static asset bundle served by backend or file server; no SSR process
- TanStack Query handles caching, background refetch, stale-while-revalidate automatically
- TanStack Router provides type-safe route params and native Query integration
- Adding a new resource = fetch function in `api/` + hook in `hooks/` + route or component

### Negative / Trade-offs

- No SSR; initial bundle load determines perceived performance
- All data flows through TanStack Query hooks — components cannot call `fetch` directly

### Risks

- RISK: Bundle size grows with feature count | MITIGATION: TanStack Router lazy route loading keeps initial bundle small

## Compliance

- MUST: All server data fetching goes through TanStack Query hooks
- MUST NOT: Components call `fetch` directly or manage their own loading/error state for server data
- MUST NOT: Use GraphQL, tRPC, or a separate BFF layer without a new ADR
- SHOULD: Client-only global state use Zustand; do not put server data in Zustand

## Review Trigger

SSR becomes a requirement (SEO, performance on slow networks), or a mobile app is added that requires a shared API client.

## Related

- SUPERSEDES: NONE
- RELATED TO: ADR-003
- REFERENCED BY: NONE
