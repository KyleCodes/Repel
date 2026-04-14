# Architecture Decision Records

## ADR-001: PostgreSQL over NoSQL

### Status

Accepted

### Context

The application stores messages, threads, classifications, tags, contacts, and relationships between them. Access patterns include: listing messages by time, filtering by tag/category/account, joining messages with their classifications and summaries, querying contacts across channels, and full-text search over message content.

The developer has recent experience with DynamoDB and is comfortable with NoSQL patterns.

### Decision

Use PostgreSQL as the sole data store.

### Rationale

The data is inherently relational. Messages belong to threads, threads belong to orgs, messages have classifications, tags, summaries, and draft replies. These relationships are first-class query concerns — the API needs to join across them constantly (e.g., "list threads with their latest message's importance score and classification").

DynamoDB would require denormalizing these relationships into composite items or maintaining multiple GSIs. Every new query pattern would require a new index or a new denormalization strategy. The data model is still evolving — adding a new derived table (e.g., digests) in Postgres is a migration; in DynamoDB it's a data modeling exercise.

Postgres also gives us: row-level security for tenant isolation, `FOR UPDATE SKIP LOCKED` for the job queue (eliminating a separate queue dependency), `pgcrypto` for credential encryption, JSONB for polymorphic fields, and full-text search without an external service.

The application runs on a single self-hosted server. There is no distributed systems requirement that would justify a NoSQL store. Postgres vertical scaling on bare metal is more than sufficient for the foreseeable load profile (personal email volume across a handful of accounts).

### Consequences

- Single dependency for data storage, queuing, and full-text search.
- Schema migrations are required for structural changes.
- If the application ever needs to handle millions of messages per day across thousands of tenants, horizontal scaling will require solutions (Citus, read replicas, or a move to a distributed database). This is not a near-term concern.

---

## ADR-002: All Tables Are Org-Scoped

### Status

Accepted

### Context

The application supports multi-tenancy (B2C as single-user orgs, B2B as multi-user orgs). Data isolation between tenants must be enforced reliably, even as the codebase grows and new queries are added.

### Decision

Denormalize `org_id` onto every table that is directly queried from the API or processing layer. Enforce tenant isolation using PostgreSQL row-level security (RLS) policies that filter on `org_id` matched against a session variable (`app.current_org_id`) set at connection checkout.

Tables accessed only via join from an already-scoped parent (e.g., `message_raw` is always accessed through `message`) may omit `org_id`.

### Rationale

RLS provides defense-in-depth. Even if a query forgets a `WHERE org_id = $1` clause, the policy prevents data leakage. This is strictly better than relying on application-layer discipline, especially for a solo developer who may be writing queries quickly.

Denormalizing `org_id` costs 16 bytes per row. The query simplification (no joins needed for tenant filtering) and RLS policy simplicity (single-column `USING` clause) justify this cost.

Alternative considered: composite primary keys including `org_id` (DynamoDB-style partition key pattern). Rejected because it complicates every foreign key reference, widens join conditions, and doesn't provide additional safety beyond what RLS already guarantees. Postgres indexes on `(org_id, ...)` give the same query performance benefits without the FK complexity.

### Consequences

- Every connection must set `app.current_org_id` before executing queries. The pool wrapper enforces this.
- New tables must include `org_id` if they'll be queried directly. Code review should catch omissions.
- RLS policies must be created for each new table. This can be automated in the migration template.

---

## ADR-003: Single Monolith, Multiple Entrypoints

### Status

Accepted

### Context

The application has three distinct runtime concerns: an HTTP API, a background worker (job processing), and a sync scheduler (polling email providers). These could be structured as separate services, a monolith, or something in between.

The developer is a sole operator deploying to a single bare-metal server.

### Decision

A single TypeScript codebase with a single build artifact. The runtime mode is selected via a `MODE` environment variable: `all` (default), `api`, `worker`, or `sync`. All modes share the same code, database pool, and business logic modules. A separate CLI entrypoint (`cli.ts`) provides non-HTTP access to the same operations.

### Rationale

There is no operational benefit to separate services at this stage. A sole developer on a single server gains nothing from deploying three containers that share a codebase and a database. The overhead of maintaining separate Dockerfiles, health checks, and inter-service communication is pure cost.

The `MODE` variable provides an escape hatch. If the worker becomes CPU-bound (LLM call volume), it can be split into a separate process by running a second instance of the same image with `MODE=worker`. This requires zero code changes — the composition root already handles it.

The monolith also simplifies debugging. A single process means a single log stream, a single debugger session, and in-process function calls instead of HTTP/gRPC between services.

### Consequences

- All components share a process. A crash in the worker crashes the API. This is acceptable for a self-hosted personal tool; it would not be acceptable for a production SaaS.
- Memory usage is higher than necessary when running in a single-component mode (unused code is loaded). Negligible at this scale.
- The architecture must avoid tight coupling between components despite them sharing a process. Components communicate through the database (job queue), not through in-process function calls that bypass the queue. This ensures they can be separated later without refactoring the interaction pattern.

---

## ADR-004: Postgres-Backed Job Queue

### Status

Accepted

### Context

The processing pipeline (classify, summarize, draft) runs asynchronously against ingested messages. A queue is needed to decouple ingestion from processing, provide retry semantics, and prevent lost work.

Options considered: in-memory queue (array), BullMQ + Redis, RabbitMQ, Postgres-backed queue.

### Decision

Use a `job_queue` table in PostgreSQL with `FOR UPDATE SKIP LOCKED` for dequeue operations.

### Rationale

The application already depends on Postgres. Adding Redis or RabbitMQ introduces a new process to manage, monitor, and back up — pure operational overhead for a self-hosted, single-developer setup.

Postgres `SKIP LOCKED` provides the essential queue semantics: exactly-once delivery (within a transaction), concurrent worker support (if ever needed), and persistence across process restarts. The job is enqueued in the same transaction as the message insert, guaranteeing no message is ingested without a corresponding job.

At personal email volume (hundreds of messages per day), polling a Postgres table every second is negligible load. The bottleneck is LLM API latency, not queue throughput.

If the application scales to a point where Postgres polling becomes a bottleneck (thousands of jobs per second), migrating to BullMQ is a localized change — swap `queue.ts` and add Redis to docker-compose.

### Consequences

- No additional infrastructure dependencies.
- Queue operations are transactional with message inserts (atomicity guarantee).
- Polling interval introduces latency floor (default 1 second). Acceptable for async processing.
- No built-in features like priority queues, rate limiting, or scheduled jobs. These can be added to the `job_queue` table schema if needed (priority column, `scheduled_for` already exists).

---

## ADR-005: Channel Abstraction via Adapter Pattern

### Status

Accepted

### Context

The MVP supports Gmail and iCloud email. The design must accommodate future channels (LinkedIn, iMessage, Slack, Discord, WhatsApp) without rewriting the data model or processing pipeline.

### Decision

Define a `ChannelAdapter` interface with `sync()` and `send()` methods. Each provider implements this interface. The processing pipeline, API, and data model operate on channel-agnostic `message` records. Channel-specific data is preserved in `message_raw` and accessed only when needed (rendering original HTML, debugging).

### Rationale

The core operations (classify, summarize, draft reply, query by tag/importance) don't care whether a message came from Gmail or iMessage. The meaningful differences between channels are confined to two boundaries: ingress (how do we fetch messages) and egress (how do we send replies). Everything in between operates on normalized data.

The adapter pattern keeps channel-specific complexity localized. Adding LinkedIn support means writing `channels/linkedin/ingress.ts` and `channels/linkedin/egress.ts`, adding `'linkedin'` to the channel enum, and running a migration. No changes to the pipeline, agent, or API.

### Consequences

- Some information loss in normalization. Email has CC/BCC; Slack has reactions and threads-within-threads; iMessage has read receipts. The `message` table carries email-ish fields (`cc_addresses`, `bcc_addresses`) that are empty for non-email channels. If channel-specific metadata becomes important for processing, it can be queried from `message_raw`.
- Thread resolution logic varies significantly by channel and lives in `channels/lib/threading.ts` as a dispatch function. This module will grow with each new channel.
- The `IngressMessage` type may need extension as new channels introduce concepts not present in email. Adding optional fields is backward-compatible; changing required fields is not.

---

## ADR-006: Classifier Config as Versioned Database Rows

### Status

Accepted

### Context

The AI classifier is configured by a human-readable markdown prompt that defines categories, tags, importance criteria, and filtering rules. This prompt will be iterated on frequently. When the prompt changes, existing classifications become stale and may need to be regenerated.

### Decision

Store classifier configs as versioned rows in a `classifier_config` table. One row per org per version. An `is_active` flag designates the current config. Classification records reference the `classifier_version` that produced them.

The markdown prompt may additionally be checked into version control as a fixture, but the database is the source of truth at runtime.

### Rationale

Storing the config in the database enables: tracking which config version produced each classification, reclassifying messages against a new version, rolling back to a previous version without a code deploy, and per-org customization in a multi-tenant context.

A file on disk or a hardcoded constant would require a deploy to change the classifier. For a self-hosted tool where the operator is constantly tuning the prompt, deploy-to-change is too high friction.

### Consequences

- The `classifier_config` table must be seeded with an initial config during setup.
- The application layer must enforce that only one config per org is active at a time.
- Reclassification (re-running all messages through a new config) is an explicit operation, not automatic on config change. This avoids unexpected LLM cost spikes.

---

## ADR-007: LLM Executor as a Shared Lib

### Status

Accepted

### Context

Multiple features require LLM calls: the classification pipeline (async, queued), automation workflows (async, queued), and the chat interface (sync, request-response). These features have different execution contexts but identical LLM interaction mechanics — build a prompt, call an API, parse the response.

Options considered: LLM executor as a separate service/process, as a queue-specific worker, or as a shared lib.

### Decision

The LLM executor is a stateless function in `src/lib/llm.ts`. It takes a prompt and configuration, returns a response. The async/sync distinction lives in the caller, not the executor.

```typescript
interface LlmRequest {
  model: string;
  systemPrompt: string;
  userContent: string;
  responseFormat?: 'text' | 'json';
}

async function execute(req: LlmRequest): Promise<LlmResponse> { ... }
```

### Rationale

The executor is a capability, not a feature. Making it a service or tying it to the queue would force all callers through the same execution path, even when their needs differ. The chat interface needs synchronous request-response with streaming. The classification pipeline needs async execution with retries and dead-letter handling. These are caller concerns, not executor concerns.

As a lib, the executor is imported by any caller in any context. The pipeline worker calls it inside a job handler with retry logic. The chat route handler calls it directly and streams the response. The automation engine calls it after evaluating trigger rules. Same function, different lifecycle management by each caller.

If LLM calls ever need centralized rate limiting or cost tracking, that logic belongs in the executor function itself (middleware pattern), not in a separate service. The function boundary is sufficient.

### Consequences

- No additional infrastructure for LLM execution.
- Callers are responsible for their own retry/timeout/error handling around the executor. The pipeline has `pipeline/lib/retry.ts`; the API has Express error middleware; the chat handler manages its own streaming lifecycle.
- Model selection, API keys, and rate limits are configured via env vars and passed into the executor at call time. No ambient configuration.

---

## ADR-008: Client-Side SPA with TanStack Stack

### Status

Accepted

### Context

The application needs a web frontend for viewing the message feed, managing accounts, reviewing draft replies, and chatting with the mailbox. The backend is a separate REST API. The frontend is accessed by a single user (initially) on a private network.

Options considered: Next.js (SSR/SSG), Vite + React Router, Vite + TanStack Router.

### Decision

Client-side rendered React SPA built with Vite. TanStack Router for routing. TanStack Query for all server data fetching. Zustand for minimal client-only global state. Plain HTTP REST — no GraphQL, no tRPC.

### Rationale

**No Next.js.** Next.js earns its keep when you need SSR, ISR, or API routes co-located with the frontend. This application has none of those needs. The backend is a separate process with its own API. The frontend is a thick client that fetches data over HTTP. Using Next.js would mean fighting the framework to not use its core features (SSR, server components, API routes) while paying for its complexity and build-time overhead.

**TanStack Router over React Router.** TanStack Router provides type-safe route params, integrates natively with TanStack Query for route-level data loading, and supports file-based route generation. It's designed for the SPA-with-REST-API pattern this project uses.

**TanStack Query for all server state.** TanStack Query handles caching, background refetching, stale-while-revalidate, loading/error states, and cache invalidation. This eliminates the need for a global state manager for server data. Components declare what data they need via hooks; TanStack Query handles the rest.

**Zustand for client-only state.** A small number of concerns are genuinely global and client-only: auth/session state, UI preferences (sidebar collapsed, theme), and potentially command palette state. Zustand handles these with minimal boilerplate. Redux is rejected as unnecessary complexity for this scope.

**No tRPC.** tRPC provides end-to-end type safety by inferring frontend types from backend router definitions. However, it couples the frontend build to the backend codebase at the type level, adds a framework abstraction over HTTP, and solves a problem already addressed by the shared Zod schema package. Importing types from `@mailbox/shared` provides the same type safety without the tRPC runtime or build-time coupling.

**No GraphQL.** The application's query patterns are well-defined and resource-oriented. GraphQL's flexibility (client-specified field selection, nested queries) adds resolver complexity, schema duplication, and tooling overhead without corresponding benefit. REST endpoints with query params handle filtering, pagination, and sparse fieldsets adequately.

### Consequences

- The frontend is a static asset bundle (HTML, JS, CSS) served by the backend or a static file server. No server-side rendering process to manage.
- Route-level code splitting is handled by TanStack Router's lazy route loading, keeping initial bundle size small.
- All data flows through TanStack Query hooks. Components do not call `fetch` directly or manage loading/error state manually.
- Adding a new API resource requires three files: a fetch function in `api/`, a TanStack Query hook in `hooks/`, and a route or component that consumes the hook.
- The shared Zod schema package is the contract between frontend and backend. Schema changes propagate type errors to both sides immediately via `tsc --build`.
