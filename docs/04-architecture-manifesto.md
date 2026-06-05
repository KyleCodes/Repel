# Application Architecture Manifesto

## 1. About This Document

This is the canonical statement of how the application is organized. It defines the top-level directory layout, the vocabulary contributors share when discussing code, and the rules that govern where new code goes and how modules may depend on each other.

It is for every contributor — human or AI agent — before they add code. The intended workflow is: read it once, top to bottom; then refer back to the rules section (§5) when adding a new mutation, view, handler, route, command, adapter, or piece of infrastructure. New contributors should expect to spend roughly twenty minutes reading the document end to end.

The document does not prescribe schema. It does not pick libraries beyond those already in use. It does not address operational concerns (deployment, observability, scaling). It does not critique prior shapes the codebase has taken; the source of truth is the target state described here, and the codebase is conformed to it through normal tickets rather than opportunistic rewrites. Migration narratives belong in pull request descriptions and ticket comments, not here.

When the document and the code disagree, the document is the source of truth and the code is wrong.

## 2. First Principles

The architecture is downstream of seven beliefs. Every rule in §5, every layout decision in §3, and every piece of vocabulary in §4 follows from one or more of these. They are stated first so that future amendments can be reasoned about against them.

**The database is a participant, not a passive store.** A relational database engine performs joins, enforces uniqueness under contention, atomically updates many tables in one statement, and returns generated values from inserts. These are capabilities the application should reach for, not coordinate around. The pattern of issuing several round trips inside one application transaction — fetching a row, mutating it in memory, fetching a related row, writing them back — wastes latency, holds locks longer than necessary, and creates concurrency hazards that the database could have prevented. Common Table Expressions, `RETURNING`, `ON CONFLICT`, and `LATERAL` joins are the tools for collapsing such patterns into single statements. The application's job is to express the use case clearly in SQL; the database's job is to execute it efficiently and correctly.

**Organize by capability, not by entity.** A folder within features/ is a thing the product _does_, not a thing the product _stores_. Grouping code by database table — one folder per table, each with its own service and repository — encourages exactly the multi-round-trip patterns the previous principle rules out, because every cross-table operation becomes a composition of single-table operations. Grouping by capability ("messaging", "categorization", "accounts") instead lets each capability's writes be shaped by what the use case actually demands, regardless of how many tables are involved.

**Triggers are details; outcomes are structure.** A unit of work belongs to the part of the system whose outcome it produces, regardless of whether a user clicked a button (HTTP), an engineer ran a command (CLI), or a job was dequeued (envelope from the queue). When a message is categorized, the code that does the categorization lives where categorization lives, even if the trigger came from a message-arrival event in a different capability. This keeps capabilities coherent: everything about how categorization works is in the categorization directory, not scattered across whatever subsystems happen to invoke it.

**Facades shape the wire; features shape the work.** Public surfaces — HTTP endpoints, CLI commands, and later MCP tool calls — are concerned with how requests arrive and responses go out: validation, authentication, error mapping, the exact shape of JSON payloads. Internal capabilities are concerned with the work itself. The two should not share types, because they answer different questions. A mutation returns a result that captures the outcome of an operation; a route reshapes that result into a response shape its consumers can rely on. Even when the two shapes are identical on the day a mutation is first written, the explicit reshape is preserved so that when they diverge, the divergence is contained to one place.

**Infrastructure is what you provision; adapters are how you talk to things.** Postgres is infrastructure: you stand up a database server, configure connection pooling, run migrations against it. Gmail is not infrastructure: you do not provision Gmail; you integrate with it. The distinction matters because the two have different lifecycles, different failure modes, and different testing strategies. Infrastructure deserves its own top-level directory because it is the substrate the application runs on. Adapters deserve their own top-level directory because they are translation layers between the application and external systems whose APIs the application does not control.

**Transactions are short and use-case-shaped.** A transaction exists to make a logically atomic operation atomic at the database level. The smaller it is — fewer statements, less elapsed time, fewer rows touched — the lower the contention it creates with concurrent transactions and the smaller the blast radius if it fails. The natural unit is one mutation: one call into the application, one transaction, ideally one round trip to the database (a CTE that does many writes is one round trip). Multi-statement, multi-round-trip transactions are a code smell that usually indicates the use case has been decomposed into entity operations rather than expressed as a single mutation.

**Read paths and write paths are different shapes.** A function that reads "give me everything I need to display the inbox screen" returns a shape determined by the screen, joins tables freely, and never mutates anything. A function that writes "ingest this batch of messages from Gmail" upserts into many tables atomically and returns minimal acknowledgment. Forcing both through a unified service-and-repository layer that pretends they have the same shape is the source of much accidental complexity. The application instead distinguishes them at the directory level: writes live in `mutations/`, reads live in `views/`. They are not symmetric operations on a shared model.

## 3. Top-Level Layout

The application source tree is the following. Each directory has one purpose, stated in a comment on the line that introduces it.

```
apps/server/src/
  features/                 # product capabilities
    accounts/               # org + user lifecycle
      mutations/            # one file per write use case; each owns its query
      views/                # one file per read use case; each owns its query
      handlers/             # async-triggered work owned by this feature
      service.ts            # public surface; decorates mutations/views; owns business rules
      error.ts              # feature-local error hierarchy (extends lib/error.ts AppError)
    messaging/              # threads, messages, contacts, attachments
      mutations/  views/  handlers/  service.ts  error.ts
    categorization/         # categories, classification results
      mutations/  views/  handlers/  service.ts  error.ts
  processing-pipeline/      # async orchestrator
    registry.ts             # nodeId → handler import
    topology.ts             # event → next-handlers wiring
    runner.ts               # consume envelope → invoke handler → emit next
    types.ts                # NodeId, Envelope, HandlerResult
  adapters/                 # provider integrations
    gmail/                  # ingress, egress, normalize
    icloud/
  infra/                    # provisioned things
    db/                     # types, migrations, runtime, tx, client
    transport/              # the queue
  api/                      # HTTP facade
    router.ts               # composer
    middleware/             # auth, error mapping, telemetry
    routes/                 # file-based routing; schemas colocated per route
  cli/                      # CLI facade
    index.ts                # composer — registers each namespace
    <namespace>/            # one dir per command namespace
      handler.ts            # registers the namespace's commands
      schemas/index.ts      # colocated zod input schemas
  main.ts                   # process entrypoint
```

The five top-level non-facade directories — `features/`, `processing-pipeline/`, `adapters/`, `infra/`, plus the `api/` and `cli/` facades — partition the application into concerns that change for different reasons. Adding a new product capability adds a directory under `features/`. Adding a new external provider adds a directory under `adapters/`. Adding a new piece of provisioned infrastructure (a cache, a search index) adds a directory under `infra/`. Adding a new HTTP endpoint adds files under `api/routes/` and (in parity) `cli/`. Adding a new asynchronous handler adds a file under the relevant feature's `handlers/` and one line in `processing-pipeline/registry.ts`.

Nothing else is added at the top level without an amendment to this document.

## 4. Definitions

This section defines the vocabulary used throughout the document and throughout the codebase. Contributors should use these terms with these meanings, and should resist the urge to introduce new terms ("module", "package", "library", "domain") that overlap with these.

**Feature.** A product capability — a thing the application does that a user could reasonably toggle on or off, and that a separate engineer could reasonably own. "Messaging" is a feature. "Threads" is not — threading is how messaging organizes its data. "Categorization" is a feature. "Bootstrap" is not — it is one mutation inside the accounts feature. The unit-test for whether a candidate is a feature is in §4 above and is elaborated with worked examples in Appendix A.

**Mutation.** A synchronous write. A mutation is one async function that takes a `Tx` and a typed input, runs one SQL statement (a writeable CTE when more than one table is involved), and returns the shape Kysely infers from the query. Mutations live at `features/<feature>/mutations/<verb-noun>.ts`. A mutation does not open transactions and is not decorated; the service that calls it does. (The term "flow" is deliberately avoided for this concept — it is reserved for multi-step processes such as an interactive OAuth flow, which are not database writes.)

**View.** A synchronous read. Same shape as a mutation but read-only: one async function taking a `Tx` and input, running one SQL statement, returning the Kysely-inferred shape. Views live at `features/<feature>/views/<verb-noun>.ts`. A view does not open transactions and is not decorated; the service that calls it does.

**Handler.** An asynchronously triggered unit of work. A handler has the same internal shape as a mutation — typed input, typed result, runs under a transaction — but is invoked by the processing pipeline rather than by a facade. A handler receives an envelope from the queue, does its work, and may return a list of further envelopes to enqueue. Handlers live in `features/<feature>/handlers/`.

**Service.** The public surface of a feature. A feature has exactly one `service.ts`. The service imports mutations and views, decorates each public operation with `runInTx` or `runInOrgTx`, and applies feature-level business rules (uniqueness checks, defaults, validation). `runInOrgTx` adds `orgId: string` to the public input type; the inner mutation/view never declares it — Postgres RLS scoped at `SET LOCAL` does the tenant filtering. Services throw errors that extend the feature's `error.ts` base (which extends the shared `AppError` in `lib/error.ts`); facades catch and map by `instanceof`.

**Queries.** Kysely expressions defined inside the mutation or view that uses them. Each mutation/view declares a private builder (`buildX(trx, input) => trx.selectFrom(...)…`), derives its result type from the builder via Kysely's type inference (e.g. `InferResult<ReturnType<typeof buildX>>[number]`), and exports the resulting type alongside the async runner. There is no per-feature query bundle and no parallel domain-type layer — Kysely's `DB` schema in `infra/db/types.ts` is the source of truth, and every return type reaches the rest of the application through inference. Use raw `sql` templates only when Kysely cannot express the statement; raw SQL is opaque to inference and forces hand-written types back into the file. Input shapes are the one exception that must be hand-written: they live next to the function that consumes them. Cross-feature reads still go through `views/` per Rule 1b.

**Envelope.** The contract between the queue (transport) and handlers. An envelope has the shape `{ kind: NodeId; orgId: string; payload: unknown; idempotencyKey?: string }`. The `kind` field identifies which handler in the registry should process it. The `orgId` field identifies the tenant the work belongs to. The `payload` is handler-specific and is typed at the handler boundary. The `idempotencyKey` is an optional deduplication hint.

**Topology.** The declarative wiring of which handlers fire in response to which events. Topology is a configuration artifact — usually a flat mapping from event types to lists of handler identifiers — that lives in `processing-pipeline/topology.ts`. Topology contains no business logic; it is wiring.

**Adapter.** A translation layer between an external provider's API or protocol and the application's normalized envelope shape. Each adapter has an ingress side (incoming data from the provider becomes envelopes) and an egress side (envelopes for outbound actions become provider API calls). Adapters live in `adapters/<provider>/`.

**Facade.** The HTTP API and CLI directories — `api/` and `cli/`. A facade owns the wire-shape of public requests and responses, the file-based routing structure, validation schemas, authentication and error-handling middleware, and any reshaping required between wire types and feature mutation/view result types. A facade is the only legitimate place for cross-feature orchestration code. Features never import from facades.

**Infra.** Provisioned things — the database, the queue. Infra is the substrate the application runs on. Adapters are not infra (you do not provision Gmail). Infra lives in `infra/`.

**Capability vs. implementation detail.** When in doubt about whether something is a feature, an entity, or an implementation detail, default to the smallest claim. A noun for data ("threads", "attachments", "contacts") is almost never a feature; it is part of whichever feature owns the data. A verb the product performs ("categorize", "search", "send") or a coherent capability the product offers ("messaging", "accounts") usually is.

## 5. Rules

The following rules are stated as single sentences so violations can be identified by code review, by lint configuration, or by `grep`. Each rule is followed by the rationale and the typical failure mode it prevents.

**Rule 1a. Facade direction.** Files under `api/` and `cli/` may import from `features/*/{mutations,views,handlers,service,types}`. Files under `features/` may NEVER import from `api/` or `cli/`.

This is the architectural backbone of the system. The facade layer is a consumer of features; features must not depend on the consumers that happen to call them, because that coupling makes it impossible to add a new consumer (a worker, an MCP surface, a script) without dragging changes through every feature. The rule can be enforced with an ESLint `no-restricted-imports` configuration; failures show up as imports that originate in `features/` and target `api/` or `cli/`.

**Rule 1b. Cross-feature reads go through views.** Files under `features/<a>/` that need to read data owned by `features/<b>/` may import from `features/<b>/views/` and `features/<b>/types/`. They may NOT reach into another feature's queries directly, regardless of where those queries physically live.

`views/` is the public read interface of a feature. Reading through views means the read shape is stable and the underlying queries can change without forcing changes in the consumer. Reaching into another feature's database-access code directly couples the consumer to the producer's internals and erodes the boundary that makes features independently ownable.

**Rule 2. Cross-feature writes compose through services.** When a write operation in one feature needs to invoke work owned by another, the calling feature's service may import the called feature's service and call its operations directly. Mutations do not import sibling features' mutations; mutations orchestrate their own feature's service, which may in turn call other features' services.

This is a deliberate two-tier structure. Mutations are the "what the user asked for" layer — they should be readable as one operation in one feature, even when the underlying work spans capabilities. Services are the "how the work happens" layer — composable across features, free to invoke each other when the use case crosses a boundary. The constraint that mutations do not import sibling mutations preserves their readability; the freedom for services to import other services keeps cross-cutting writes ergonomic without resorting to events when events are not yet warranted.

The longer-term tightening — "cross-feature writes coordinate through events, not through direct service imports" — is deferred until either the second asynchronous handler exists or a second engineer joins the codebase. When that point arrives, services that currently import other services will be refactored to enqueue envelopes; the events-based pattern becomes the default and direct service imports become the exception that requires justification. The deferral is deliberate: imposing the events-based pattern now means building transport, an envelope catalog, and handlers for work that does not yet need them. Imposing it later is a bounded refactor.

**Rule 3. One mutation = one transaction = one round trip when possible.** A mutation opens exactly one transaction. Inside that transaction, the mutation executes as few SQL statements as the use case allows — ideally one. If a mutation opens more than one query inside its transaction, the additional queries are justified in a code comment.

Two-round-trip writes (read a row, decide something in application code, write a row) introduce a window during which concurrent transactions can invalidate the decision. They are sometimes unavoidable when the decision genuinely depends on application logic (for example, an LLM call), but when the decision is a uniqueness check, a foreign key lookup, or a conditional update, the database can do it atomically with `ON CONFLICT`, `RETURNING`, or a `WHERE` clause on the write. The rule's purpose is to make every multi-round-trip transaction visible: the comment is the place where the author proves the use case requires it.

**Rule 4. Mutations return domain results; facades shape wire responses.** A mutation's return type is shaped by the work it performs, not by what an HTTP response or a CLI output happens to look like. Facades wrap mutations: the route handler calls the mutation, then maps the result to a wire response. Even when the two shapes are identical on the day the mutation is written, the explicit reshape function exists.

The day the wire shape diverges from the mutation result — a field is added to the API response that the mutation does not produce, or a field is renamed, or two mutations are combined into one endpoint — the change is contained to the reshape function. Without the reshape, the divergence either bloats the mutation's return type with API-shaped fields or leaks internal fields into the public surface. The cost of writing the reshape on day one is trivial; the cost of retrofitting it later is significant, because every consumer of the unified type must be re-examined.

**Rule 5. Feature internal structure: `mutations/`, `views/`, `handlers/`, `service.ts`, `error.ts`.** Each feature directory contains these five top-level entries. Additional files or directories within a feature are permitted as the shape of the codebase clarifies.

- **`mutations/<verb-noun>.ts`** — one file per write use case. Plain `async (trx, input) => ...`; owns its query builder and its inferred result type. Promoted to a `<verb-noun>/` directory with step-files only when a single mutation grows past approximately 150 lines.
- **`views/<verb-noun>.ts`** — one file per read use case. Same shape as a mutation but read-only.
- **`handlers/`** — async entry points consumed by `processing-pipeline/`. Same shape as a mutation.
- **`service.ts`** — exactly one per feature. Decorates mutations/views with `runInTx`/`runInOrgTx`, owns business rules, and is the only legitimate import target for facade code and other features' services. When the file grows uncomfortable, the split is by operation cluster, not by entity — `service/categorize.ts`, `service/reclassify.ts` is acceptable; `service/category.ts`, `service/result.ts` is not.
- **`error.ts`** — feature-local error hierarchy: an abstract feature-base extending `AppError`, plus concrete subclasses thrown by service methods.

Each mutation/view file is the smallest meaningful unit of database work — one query, one inferred type, one runner. `service.ts` is the only file that opens transactions and applies business rules. The five-entry shape rules out both the per-entity quartet pattern and the per-feature query bundle: every read or write is owned by the file that names the use case.

**Rule 6. Adapters never import features; features never import adapters.** Adapters communicate with features exclusively through transport envelopes — adapter ingress emits envelopes; handlers consume them; handler-emitted envelopes are routed back to adapter egress.

This is the constraint that makes the channel-agnostic claim in the product specification real. If the categorization feature imported `adapters/gmail/`, then categorization would only work for Gmail; adding iCloud would require changes inside categorization. The envelope is the lingua franca that lets each side evolve independently. Violations show up as import statements crossing the boundary; they are detectable by the same lint configuration that enforces Rules 1a and 1b.

**Rule 7. The processing pipeline owns no business logic.** Files under `processing-pipeline/` contain wiring (the registry mapping handler identifiers to handler functions), topology (the mapping from event types to next-handlers), runner code (the loop that pulls envelopes from transport, looks up the handler, invokes it under a transaction, and enqueues any returned events), and the types these things share. They do not contain knowledge of what categorization does, what messaging does, or what an adapter's payload looks like beyond the envelope wrapper.

The pipeline is replaceable infrastructure. If the application later moves from a hand-rolled queue to an external system (Inngest, Temporal, RabbitMQ), the pipeline is what changes; handlers do not. Handlers are unit-testable without a queue: feed an envelope in, assert on the returned next-events. The pipeline is integration-testable separately by wiring it to a fake transport.

**Rule 8. Schemas are colocated with routes and commands.** Validation schemas live next to the route or command they validate. They do not live in a central `schemas/` directory.

This is a corollary of the file-based routing convention in §6. A route directory contains everything needed to serve the route: the handler, the schema, any reshape helpers. Centralized schemas create coupling at a distance — changing a route requires touching two locations — and they erode the ability to read a route directory and understand what it does without further navigation.

## 6. Facade Conventions

Both `api/` and `cli/` use file-based routing. The directory hierarchy is the URL hierarchy (for HTTP) and the command tree (for CLI). The two are kept in parity: a CLI command exists for every public HTTP route, with the same name and the same argument shape, until and unless this becomes infeasible. The CLI exists to simulate the public API surface for internal development use during the period before a frontend exists.

```
api/routes/
  threads/
    index.ts                # GET /threads        → calls list-threads view
    schema.ts
    [threadId]/
      index.ts              # GET /threads/:threadId
      schema.ts
      messages/
        index.ts            # GET /threads/:threadId/messages
        schema.ts
  accounts/
    index.ts                # POST /accounts (bootstrap)
    schema.ts
    provider-accounts/
      index.ts              # POST /accounts/provider-accounts
      schema.ts

cli/
  orgs/
    handler.ts              # registers `repel orgs ...` (bootstrap)
    schemas/index.ts
  accounts/
    handler.ts              # registers `repel accounts ...` (list/show/rm/add)
    schemas/index.ts
```

Each route or command directory contains its handler (the file that exports the route or command function), its zod schema (the file that defines the input validation), and any small reshape helpers required to map between wire shapes and feature mutation/view result types. If a route grows complex enough to warrant additional helpers, they live in the same directory.

The composer at the top of each facade — `api/router.ts` and `cli/index.ts` — is responsible for traversing the directory tree at boot time and registering routes and commands. The composer should be small and mechanical; it does not contain domain logic.

CLI parity is a stated goal during the pre-frontend period. The CLI is intended for internal developer use, not for end customers, and exists primarily to give engineers a way to exercise the public API surface from a terminal while the frontend is being built. If at scale CLI parity becomes infeasible — because the API surface grows into shapes that do not translate well to command-line arguments — this document will be amended. Until then, parity is the rule.

Cross-feature orchestration commands belong at the facade level. A hypothetical `repel demo-seed` command that creates an organization, attaches provider accounts, and ingests a fixture mailbox spans three features (accounts, messaging, possibly categorization). Such a command lives in `cli/`, not inside any feature directory. The facade is the only legitimate place for code that orchestrates work across feature boundaries.

The wire shapes of HTTP responses and CLI outputs are not the same as the internal mutation result types. Even when they appear identical on the day a route is first written, the explicit reshape function exists. This is Rule 4, restated here because facade authors are the people most often tempted to skip the reshape on the grounds that it looks like duplication.

## 7. Asynchronous Work and the Processing Pipeline

The processing pipeline carries asynchronously triggered work. It has three responsibilities: maintaining a registry of handlers (one per node in the topology), declaring the topology that wires handlers to events, and running the dispatch loop that pulls envelopes from transport, invokes the relevant handler, and enqueues any next-events the handler emits.

**Registry.** `processing-pipeline/registry.ts` is a typed mapping from `NodeId` (the `kind` field of an envelope) to the handler function that processes envelopes of that kind. The registry imports handlers from features and exports the mapping. Adding a new handler is one new line in this file.

**Topology.** `processing-pipeline/topology.ts` declares which handlers fire in response to which events. The initial form is a flat mapping from event types to lists of handler identifiers — for example, `'message-arrived' → ['categorize-message', 'detect-attachments']`. This handles linear chains and trivial fan-out. A more expressive DSL (a directed acyclic graph language, branching conditionals, fan-in barriers) is deferred until at least three real DAGs exist whose shapes can be compared. Premature expressiveness in the topology is a known cost; flat maps are sufficient for the foreseeable future.

**Runner.** `processing-pipeline/runner.ts` is the dispatch loop. It receives an envelope from transport, looks up the handler in the registry, opens a tenant-scoped transaction with the envelope's `orgId`, invokes the handler, and for any next-events the handler returns, enqueues them via transport.

**Types.** `processing-pipeline/types.ts` defines `NodeId`, `Envelope`, `HandlerResult`, and any other types shared by registry, topology, and runner.

The pipeline directory is empty in shape until a second handler exists. The structure is reserved; the code is not written prematurely. The first handler — whenever it appears — can run from a feature directory directly, invoked synchronously from a mutation, with the pipeline's machinery introduced when the second handler creates a real need for orchestration.

A handler is unit-testable without a queue. The test feeds an envelope in, asserts on the returned next-events and on the database state after the handler runs. Transport is mockable behind a single `Transport` interface; the runner is integration-testable against a fake transport. This separation — handlers as pure(-ish) functions that take an envelope and return events, transport as the system that moves them — is what makes the eventual swap to an external queue (SQS, RabbitMQ, Kafka, Inngest, Temporal) a transport replacement rather than a handler rewrite.

## 8. Adapters

An adapter is the translation layer between an external provider's protocol and the application's normalized envelope shape. Each provider gets its own directory under `adapters/`. A typical adapter directory contains:

```
adapters/gmail/
  ingress/                  # webhook receiver, history-list poller
  egress/                   # send-message via Gmail API
  normalize.ts              # provider payload → normalized envelope
  types.ts                  # provider-specific types
```

**Ingress.** The ingress side of an adapter receives data from the provider — by webhook, polling, or a long-lived connection — normalizes it into the application's envelope shape, and emits envelopes onto transport. Ingress code does not import from `features/`. It speaks one language (the envelope contract) and that language is enough.

**Egress.** The egress side of an adapter is registered against transport as a consumer of outbound-action envelopes. When a feature handler decides "send this message", it enqueues an envelope of kind `send-message` with a `providerAccountId` in the payload. The egress consumer picks up the envelope, looks up the provider account to determine which provider's adapter should handle it, and routes accordingly. This routing logic is the only place in the system that knows which providers exist.

**Normalize.** The normalization function maps the provider's payload shape into the application's normalized message shape. This is the place where Gmail's `threadId`, iCloud's `Message-ID` and `References` headers, and (eventually) LinkedIn's conversation identifiers are reduced to a uniform shape that downstream features can process without knowing which provider produced them.

The architectural commitment in the product specification — that the processing pipeline operates on normalized messages and is channel-agnostic — is realized by Rule 6 (adapters and features do not import each other) plus the egress routing pattern (the only code that knows which providers exist is the egress consumer). Adding a new provider is a new directory under `adapters/`, a new entry in the egress routing table, and (if the provider has unusual capabilities) zero or more new envelope kinds. It is never a change inside any feature.

## 9. Infrastructure

Infrastructure code lives in `infra/`. The application's infrastructure today is the Postgres database and (eventually) the asynchronous job queue.

**`infra/db/`.** Contains the Kysely client, the `DB` interface that mirrors the SQL schema, the lazy-initialized runtime singleton, the transaction decorators (`runInOrgTx` for tenant-scoped mutations that activate row-level security via `SET LOCAL app.current_org_id`, and `runInTx` for unscoped operations like bootstrap), the migrations directory, and shared SQL helpers. The transaction decorators are the load-bearing abstraction here — every mutation and every handler runs inside one of them, which is what guarantees that transactions are short and that tenant isolation is enforced at the database level rather than relying on application discipline.

**`infra/transport/`.** Contains the queue. Today this is implemented in Postgres (either via a hand-rolled `job_queue` table or via a library such as pg-boss). The queue is not domain data — it is plumbing — and the table that backs it should be treated as opaque infrastructure rather than as something application code queries directly. Replacing this directory with an external system (SQS, RabbitMQ, Kafka, or a managed orchestration service) is the eventual evolution path; the design constraint is that nothing outside `infra/transport/` and `processing-pipeline/runner.ts` should know which implementation is in use.

The directory structure under `infra/` is shallow on purpose. As more provisioned components enter the picture — a search index, a cache, a blob store — each gets a directory at the same level. They do not nest under each other.

## 10. What This Document Does Not Decide

The document constrains the architecture and the vocabulary, but it deliberately leaves a number of decisions open for future tickets, sub-documents, or amendments. Listing them explicitly prevents the document from being interpreted as having opinions it does not have.

The choice of asynchronous job queue implementation is open. Whether the application uses a hand-rolled `job_queue` table, a library such as pg-boss, or an external service such as Inngest or Temporal is a separate decision, made when the second handler exists.

The schema of the eventual asynchronous job event log is open. The expectation is that there will be one — an org-scoped table recording state transitions for handler invocations, with the current state of a job derivable as a view over its events — but the precise shape is deferred.

The public API contract is not defined here. Each feature owns the shape of its public endpoints, subject to the facade rules in §6.

A testing strategy beyond the points already noted ("handlers are testable without a queue, mutations are testable without a server") is not prescribed here. Test conventions are documented separately.

Authorization beyond the existing tenant-isolation pattern (row-level security keyed on `app.current_org_id`) is not addressed here. Per-route authorization, per-resource authorization, and per-field authorization are facade-level concerns; when they are introduced, they live in `api/middleware/` and are documented separately.

Operational concerns — deployment topology, monitoring, alerting, SLOs, on-call procedures — are not addressed here. They live in deployment documentation.

## 11. When To Revisit This Document

The document is intentionally durable, not eternal. Several conditions should trigger a review of one or more of its rules.

A feature directory whose `mutations/`, `views/`, or `handlers/` exceeds approximately eight entries is a signal to consider splitting the feature. The fix is usually to identify a subset of operations that share an internal coherence and promote them to a sibling feature directory. The wrong fix is to nest `mutations/` deeper.

Two engineers — or two AI agents — repeatedly needing to edit the same feature for unrelated reasons is a similar signal. A feature should be ownable by one contributor at a time; concurrent unrelated edits to it usually mean it has accreted more than one capability.

The "rip out a feature cleanly" property breaking — that is, a situation in which deleting a feature directory leaves dangling imports across the rest of the codebase — is a sign that Rules 1a, 1b, or 2 have eroded, and the import graph should be re-examined.

The existence of a third asynchronous DAG is the trigger to consider whether `topology.ts` should move from a flat map to a more expressive form.

A non-Postgres data store entering the picture (a search index that owns part of the read path, a cache that owns part of the write path) is the trigger to re-examine the "database is a participant" principle and the related rules about transactions and round trips.

Reaching the point where the codebase has a second engineer, or where the second asynchronous handler is being written, is the trigger to revisit Rule 2 and consider tightening cross-feature write coordination to run through events.

## 12. Amendment Process

This document is living. It is amended through pull requests like any other file in the repository.

Substantive amendments — adding a rule, removing a rule, restructuring the layout, redefining a term — require a pull request that includes a rationale and at least one concrete example of why the existing wording fails. The bar is intentionally moderate: the document is meant to be amended when it is wrong, not preserved out of inertia, but its rules constrain a great deal of code and should not be changed casually.

Editorial amendments — clarifying a sentence, fixing an example, improving an analogy — need no special ceremony. They go through normal code review like any other change.

When this document and the code disagree, the document is the source of truth and the code is wrong. New code conforms to the document. Existing code that does not conform is migrated through normal tickets, not through opportunistic rewrites mixed into unrelated changes.

## Appendix A. "Is This A Feature?" — Worked Examples

The unit-test in §4 — could a user reasonably toggle this on or off; could a separate engineer reasonably own it — is necessary but not sufficient. The right call is sometimes obvious and sometimes a judgment call. The following worked examples calibrate that judgment.

**`messaging` — YES.** Users can imagine an inbox with or without it; it is the inbox. One engineer could own all of ingest, threading, contacts, and attachments without bleeding into other domains. Toggling it off would remove the entire core experience of the product but would leave accounts, categorization (with no targets), and infrastructure intact.

**`threads` — NO.** Threads are an implementation detail of messaging. A thread is a derived view over messages — a grouping by conversation. There is no "threads" capability the user toggles on or off; threading is how messaging organizes itself. Lives inside `features/messaging/`.

**`attachments` — NO.** Same reasoning as threads. An attachment is an aspect of a message, not a standalone capability. Lives inside `features/messaging/` — its writes are inserts performed as part of the ingest write path; its reads are projections joined into messaging views.

**`accounts` — YES.** Org and user lifecycle is independently ownable. "The system has accounts" is a togglable surface in the sense that a single-tenant deployment without orgs is a coherent product variant; the multi-tenant feature is something the product offers, not the substrate the product runs on.

**`provider-accounts` — JUDGMENT CALL.** Provider accounts (the records linking a user to a Gmail or iCloud login) currently live inside `features/accounts/` as a sub-area, because one engineer reasonably owns the whole user/org/provider-account graph. Promote provider accounts to their own feature `features/provider-accounts/` when either of two conditions holds: a non-trivial provider-account UI exists with its own mutations (connection management, the OAuth flow, scope changes), or it acquires its own asynchronous handlers (token refresh, connection health monitoring). Until either of those conditions holds, sub-area is the right shape.

**`categorization` — YES.** Independently togglable: the inbox can ship in a v0 form without categorization; categorization plugs in later. Independently ownable: the skill set involved (LLM prompt engineering, evaluation harnesses, category taxonomy design) is different from the skill set involved in messaging. Has its own user-facing configuration surface (categories, prompts, scoring).

**`search` — YES (when it exists).** Cross-cuts messaging, categorization, and contacts but is its own capability. The fact that search reads from multiple features does not make it part of any of them; it imports their `views/` to compose the search index or to serve query results.

**`preferences` — YES (when it exists).** User-level configuration that affects many features but belongs to none of them. The right shape is a small feature whose mutations update preference rows and whose views expose them; consuming features read preferences through the preferences view, just as cross-feature reads do everywhere else.

**`migrations` — NO.** Infrastructure. Lives in `infra/db/` (or wherever the migration runner is hosted), not under `features/`. There is no user-facing surface for migrations and no engineer would meaningfully "own" them as a product capability.

**`bootstrap` — NO.** Bootstrap is a single mutation inside `features/accounts/` that creates the first organization and the first user atomically. It is one operation, not a coherent capability. Cross-feature seed and demo routines that do more than bootstrap (creating an org, attaching provider accounts, ingesting a fixture mailbox) live at the facade level, not inside any feature.

**`async jobs` / `processing-pipeline` — NO.** Plumbing. The processing pipeline is the carrier of asynchronous work; it lives at the top level alongside `features/`. The work it carries — categorization, draft generation, automation firing — belongs to the features that own the outcomes. The carrier is not a feature.

The pattern that emerges from these examples is the following. If the candidate is a noun for data — threads, attachments, contacts, messages — it is almost never a feature; it is part of whichever feature owns the data. If the candidate is a verb the product performs — categorize, search, send — or a coherent capability the product offers — messaging, accounts, preferences — it usually is a feature. When uncertain, the safer default is to start as a sub-area inside an existing feature; promotion later, when the sub-area earns its own boundary, is cheaper than demotion when an over-eager feature directory turns out to have been an entity in disguise.

A sub-area is not a feature. It does not get its own `service.ts` or `error.ts`; it lives inside the parent feature's files. Promoting a sub-area to a feature is the act of giving it the structure described in Rule 5.

## Further Reading

For the intellectual lineage of the decisions in this document — vertical slice architecture, lowercase CQRS, functional core / imperative shell, the case for SQL-as-authorship, the historical critique of object-relational mapping, the Postgres-specific tools that make the "database as participant" principle realizable, and the counterweight literature on aggregates and bounded contexts — see `docs/reading-list/db-design/`. The reading list is not required to use this document; it is for contributors who want to understand why the architecture takes the shape it does.
