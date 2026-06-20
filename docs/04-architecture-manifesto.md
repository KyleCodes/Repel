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

The repository is a Bun + Nx monorepo of per-project workspace packages, grouped by platform. Each package is an independent `@repel/*` workspace with its own `package.json` (declaring exactly the dependencies it imports), its own `tsconfig.json` (project references generated by `nx sync` from the dependency graph), and Nx tags that gate who may import it. Three kinds of package exist: **apps** (deployable processes — they are run, never imported) under `<platform>/apps/`; **libs** (importable code) under `<platform>/libs/` or `packages/shared/`; and the **cli** (the developer toolbox — a single privileged package, neither deployed nor imported). A fourth concept, the **stack**, is not a package at all — see below.

```
packages/
  shared/                   # scope:shared — isomorphic, imports nothing but shared
    enums/                  # @repel/enums   (type:lib)
    errors/                 # @repel/errors  (type:lib)
    http/                   # @repel/http    (type:lib)
    slug/                   # @repel/slug    (type:lib)
  backend/
    apps/                   # scope:backend, type:app — run, never imported
      api/                  # @repel/backend-api     — HTTP facade;  entrypoint src/main.ts, exports ./start
      sync/                 # the sync STACK (a grouping dir, not a package)
        sync-worker/        # @repel/backend-sync-worker — consumes the `sync` topic
      cli/                  # @repel/backend-cli     (type:cli) — developer toolbox + launcher
    libs/                   # scope:backend, type:lib — importable
      features/             # @repel/backend-features  (area:feature)  product capabilities
        accounts/           #   mutations/ views/ handlers/ service.ts error.ts
      adapters/             # @repel/backend-adapters  (area:adapter)  provider integrations
        gmail/              #   ingress, egress, normalize
      sync/                 # @repel/backend-sync   sync orchestration over the persistence services
      queue/                # @repel/backend-queue  the queue: client + Postgres transport + consumer runtime
      db/                   # @repel/backend-db     types, migrations, runtime, tx, client
      crypto/               # @repel/backend-crypto credential encryption at rest
      env/                  # @repel/backend-env    env-var accessors
  frontend/
    apps/
      web/                  # @repel/web  (type:app, scope:frontend) — React + Vite SPA
    libs/                   # (empty for now — FE libs land as the SPA grows)
```

**Apps are deployables; libs hold the work.** An app is a unit of independent deployment: one image, one compose service, one scaling knob. It owns app logic — the HTTP server definition, request parsing, the queue-client calls, the consumer instantiation, the handler bodies — and delegates to services in libs. Apps are not minimally thin and libs are not maximally fat; an app does real app work and calls into libs for the capabilities. The role (api / sync-worker / …) is selected by which app a process runs — there is no `MODE` switch and no single combined `main.ts` (see ADR-003).

**Apps are very nearly un-importable.** An app's `package.json` exposes exactly one entry in its `exports` map: `./start`, its launch function (e.g. `@repel/backend-api/start` → `startApi`). Everything else in the app is private — no other package can resolve an app's internals, and the boundary rules forbid any `type:lib` or `type:app` from importing `./start` at all. The single permitted consumer of `./start` is the cli (see ADR-015). This is what keeps apps mutually un-importable (`type:app ↛ type:app`, so api cannot import sync-worker) while still allowing the launcher to boot them.

**The cli is the developer toolbox, not an app.** It carries its own tag, `type:cli` (not `type:app`), because it is short-lived, never deployed, and privileged to reach across the system — it is the only package permitted to import an app's `./start`. `cli services run <name>` resolves config, renders the env a service needs, and calls that app's `start()`; `cli services run --all` calls every registered app's `start()` in one process, giving a single event loop and a single step-debugger for end-to-end work. In production each app is its own container; Compose invokes `cli services run <name>` per service so config/env resolution is identical to development.

**A stack is a folder, not a package.** A stack is a grouping directory of related apps (e.g. `apps/sync/`) plus a docker-compose fragment that deploys them together — the spiritual equivalent of a CloudFormation/CDK stack, minus the synthesis step. It has no `package.json` and is invisible to the Nx project graph, exactly like the `packages/backend/` grouping directory itself. The cohesion a stack expresses lives in its lib (`libs/sync`); the apps under `apps/sync/` are thin composition roots over it. Today `apps/sync/` holds one app (`sync-worker`); it grows by adding sibling apps, never by teaching one app to run multiple processes.

**A package's public surface is its `exports` map** (ADR-015): it lists the real source files other packages may import; everything else is private. A feature lib like `@repel/backend-features` exports only `./accounts/service` and `./accounts/error` — its `mutations/` and `views/` are unreachable from outside the package, which is how Rule 1b is enforced across packages (see §5).

Adding a product capability adds a feature module inside `@repel/backend-features` (or, when it warrants isolation, a new `libs/` package). Adding an external provider adds a directory under `@repel/backend-adapters`. Adding a new lib package adds a directory under the appropriate `<platform>/libs/` with a `package.json` carrying `type:lib` + its `scope:` tag. Adding a new deployable adds a `type:app` package under a stack directory in `<platform>/apps/`, exposing only `./start`, and a corresponding compose service. Nothing is added at the top level — and no new tag dimension is introduced — without an amendment to this document.

## 4. Definitions

This section defines the vocabulary used throughout the document and throughout the codebase. Contributors should use these terms with these meanings, and should resist the urge to introduce new terms ("module", "package", "library", "domain") that overlap with these.

**Feature.** A product capability — a thing the application does that a user could reasonably toggle on or off, and that a separate engineer could reasonably own. "Messaging" is a feature. "Threads" is not — threading is how messaging organizes its data. "Categorization" is a feature. "Bootstrap" is not — it is one mutation inside the accounts feature. The unit-test for whether a candidate is a feature is in §4 above and is elaborated with worked examples in Appendix A.

**Mutation.** A synchronous write. A mutation is one async function that takes a `Tx` and a typed input, runs one SQL statement (a writeable CTE when more than one table is involved), and returns the shape Kysely infers from the query. Mutations live at `features/<feature>/mutations/<verb-noun>.ts`. A mutation does not open transactions and is not decorated; the service that calls it does. (The term "flow" is deliberately avoided for this concept — it is reserved for multi-step processes such as an interactive OAuth flow, which are not database writes.)

**View.** A synchronous read. Same shape as a mutation but read-only: one async function taking a `Tx` and input, running one SQL statement, returning the Kysely-inferred shape. Views live at `features/<feature>/views/<verb-noun>.ts`. A view does not open transactions and is not decorated; the service that calls it does.

**Handler.** The work a queue consumer runs for one envelope. A handler has the same internal shape as a mutation — typed input, typed result, runs under a tenant transaction — but is invoked by a consumer (`consume(topic, handler)`) rather than by a facade. It receives an envelope, does its work, and when it needs to trigger downstream work it calls `enqueue(topic, payload)` directly — there is no router that fans out a handler's return value. The handler body is app code (it lives in the app that runs the consumer, or in a feature's `handlers/`); the queue lib that delivers the envelope owns no knowledge of what the handler does.

**Service.** The public surface of a feature. A feature has exactly one `service.ts`. The service imports mutations and views, decorates each public operation with `runInTx` or `runInOrgTx`, and applies feature-level business rules (uniqueness checks, defaults, validation). `runInOrgTx` adds `orgId: string` to the public input type; the inner mutation/view never declares it — Postgres RLS scoped at `SET LOCAL` does the tenant filtering. Services throw errors that extend the feature's `error.ts` base (which extends the shared `AppError` in `lib/error.ts`); facades catch and map by `instanceof`.

**Queries.** Kysely expressions defined inside the mutation or view that uses them. Each mutation/view declares a private builder (`buildX(trx, input) => trx.selectFrom(...)…`), derives its result type from the builder via Kysely's type inference (e.g. `InferResult<ReturnType<typeof buildX>>[number]`), and exports the resulting type alongside the async runner. There is no per-feature query bundle and no parallel domain-type layer — Kysely's `DB` schema in `libs/db` (`@repel/backend-db`) is the source of truth, and every return type reaches the rest of the application through inference. Use raw `sql` templates only when Kysely cannot express the statement; raw SQL is opaque to inference and forces hand-written types back into the file. Input shapes are derived from the generated schema, not hand-written, and every db input uses a table-namespaced envelope — one member per table named by the table — so the call site always says which entity a column belongs to. A write-value member is `Insertable<Table>` (or `Updateable<Table>`), narrowed with `Omit<…>` for columns the query supplies itself (joined ids, literals); a where-key member is `Pick<Selectable<Table>, …>` (the predicate columns); a discriminated lookup is a union of enveloped arms. The one exception is `orgId`: it is never inside an envelope — it is the `runInOrgTx` tenant scope, supplied top-level and stripped by the decorator before the view (the view never filters on it; RLS does). Every member ties to the generated table interfaces so it cannot drift; a service reuses the mutation/view's exported input type (pure passthrough) unless its public contract genuinely differs. Cross-feature reads still go through `views/` per Rule 1b.

**Envelope.** The contract between the queue and a consumer's handler, owned by `libs/queue`. An envelope has the shape `{ topic: string; orgId: string; payload: unknown; idempotencyKey?: string }`. The `topic` field names the logical queue an envelope belongs to (and the consumer bound to it). The `orgId` field identifies the tenant the work belongs to and scopes the handler's transaction. The `payload` is handler-specific and is typed at the handler boundary. The `idempotencyKey` is an optional deduplication hint. (Earlier drafts keyed the envelope on `kind: NodeId` so a registry could route it to a handler; with routing collapsed to a `topic` column a consumer subscribes to, the field is `topic` and the registry is gone — see §7.)

**Adapter.** A translation layer between an external provider's API or protocol and the application's normalized envelope shape. Each adapter has an ingress side (incoming data from the provider becomes envelopes) and an egress side (envelopes for outbound actions become provider API calls). Adapters live in `adapters/<provider>/`.

**Facade.** The HTTP API and CLI directories — `api/` and `cli/`. A facade owns the wire-shape of public requests and responses, the file-based routing structure, validation schemas, authentication and error-handling middleware, and any reshaping required between wire types and feature mutation/view result types. A facade is the only legitimate place for cross-feature orchestration code. Features never import from facades.

**Infra.** A _category_, not a directory: the provisioned things the application runs on — the database and the queue. The distinction is provision-vs-integrate: you provision Postgres and the queue (stand them up, configure them, run migrations against them); you do not provision Gmail, you integrate with it (so Gmail is an adapter, not infra). The category is load-bearing for the adapter boundary. The _code_ that talks to provisioned things is ordinary backend libs — `libs/db` (`@repel/backend-db`) and `libs/queue` (`@repel/backend-queue`) — not a separate top-level `infra/` directory. (Earlier drafts placed this code under `infra/`; the REP-60 restructure made every importable thing a `libs/` package, so the directory is gone while the concept stays.)

**Capability vs. implementation detail.** When in doubt about whether something is a feature, an entity, or an implementation detail, default to the smallest claim. A noun for data ("threads", "attachments", "contacts") is almost never a feature; it is part of whichever feature owns the data. A verb the product performs ("categorize", "search", "send") or a coherent capability the product offers ("messaging", "accounts") usually is.

## 5. Rules

The following rules are stated as single sentences so violations can be identified by code review, by lint configuration, or by `grep`. Each rule is followed by the rationale and the typical failure mode it prevents.

**Rule 1a. Facade direction.** Files under `api/` and `cli/` may import from `features/*/{mutations,views,handlers,service,types}`. Files under `features/` may NEVER import from `api/` or `cli/`.

This is the architectural backbone of the system. The facade layer is a consumer of features; features must not depend on the consumers that happen to call them, because that coupling makes it impossible to add a new consumer (a worker, an MCP surface, a script) without dragging changes through every feature. Enforced two ways: facades (`api`/`cli`) are `type:app` and therefore expose no `exports` map, so a feature lib _cannot resolve_ them as modules; and the `@nx/enforce-module-boundaries` constraint `type:lib ↛ type:app` fails `nx lint` for any lib that imports an app, the moment such an import could resolve.

**Rule 1b. Cross-feature reads go through views.** Files under `features/<a>/` that need to read data owned by `features/<b>/` may import from `features/<b>/views/` and `features/<b>/types/`. They may NOT reach into another feature's queries directly, regardless of where those queries physically live.

`views/` is the public read interface of a feature. Reading through views means the read shape is stable and the underlying queries can change without forcing changes in the consumer. Reaching into another feature's database-access code directly couples the consumer to the producer's internals and erodes the boundary that makes features independently ownable.

Cross-_package_ this is already absolute: a feature package's `exports` map publishes only its `service` and `error`, so no other package can import its `views`/`mutations` at all (ADR-015). The residual case — one feature reaching a _sibling_ feature's `views/` directly _within the same package_ — is not expressible at project granularity by `@nx/enforce-module-boundaries` (a feature importing its own siblings' views is legal; importing their mutations/service is not, and tags cannot say "everyone except the sibling service"). It remains a reviewed convention until features are split into per-feature packages or a custom rule lands (tracked as a deferred Nx item).

**Rule 2. Cross-feature writes compose through services.** When a write operation in one feature needs to invoke work owned by another, the calling feature's service may import the called feature's service and call its operations directly. Mutations do not import sibling features' mutations; mutations orchestrate their own feature's service, which may in turn call other features' services.

This is a deliberate two-tier structure. Mutations are the "what the user asked for" layer — they should be readable as one operation in one feature, even when the underlying work spans capabilities. Services are the "how the work happens" layer — composable across features, free to invoke each other when the use case crosses a boundary. The constraint that mutations do not import sibling mutations preserves their readability; the freedom for services to import other services keeps cross-cutting writes ergonomic without resorting to events when events are not yet warranted.

The longer-term tightening — "cross-feature writes coordinate through events, not through direct service imports" — is deferred until either the second asynchronous handler exists or a second engineer joins the codebase. When that point arrives, services that currently import other services will be refactored to enqueue envelopes; the events-based pattern becomes the default and direct service imports become the exception that requires justification. The deferral is deliberate: imposing the events-based pattern now means building out the queue, an envelope catalog, and handlers for work that does not yet need them. Imposing it later is a bounded refactor.

**Rule 3. One mutation = one transaction = one round trip when possible.** A mutation opens exactly one transaction. Inside that transaction, the mutation executes as few SQL statements as the use case allows — ideally one. If a mutation opens more than one query inside its transaction, the additional queries are justified in a code comment.

Two-round-trip writes (read a row, decide something in application code, write a row) introduce a window during which concurrent transactions can invalidate the decision. They are sometimes unavoidable when the decision genuinely depends on application logic (for example, an LLM call), but when the decision is a uniqueness check, a foreign key lookup, or a conditional update, the database can do it atomically with `ON CONFLICT`, `RETURNING`, or a `WHERE` clause on the write. The rule's purpose is to make every multi-round-trip transaction visible: the comment is the place where the author proves the use case requires it.

**Rule 4. Mutations return domain results; facades shape wire responses.** A mutation's return type is shaped by the work it performs, not by what an HTTP response or a CLI output happens to look like. Facades wrap mutations: the route handler calls the mutation, then maps the result to a wire response. Even when the two shapes are identical on the day the mutation is written, the explicit reshape function exists.

The day the wire shape diverges from the mutation result — a field is added to the API response that the mutation does not produce, or a field is renamed, or two mutations are combined into one endpoint — the change is contained to the reshape function. Without the reshape, the divergence either bloats the mutation's return type with API-shaped fields or leaks internal fields into the public surface. The cost of writing the reshape on day one is trivial; the cost of retrofitting it later is significant, because every consumer of the unified type must be re-examined.

**Rule 5. Feature internal structure: `mutations/`, `views/`, `handlers/`, `service.ts`, `error.ts`.** Each feature directory contains these five top-level entries. Additional files or directories within a feature are permitted as the shape of the codebase clarifies.

- **`mutations/<verb-noun>.ts`** — one file per write use case. Plain `async (trx, input) => ...`; owns its query builder and its inferred result type. Promoted to a `<verb-noun>/` directory with step-files only when a single mutation grows past approximately 150 lines.
- **`views/<verb-noun>.ts`** — one file per read use case. Same shape as a mutation but read-only.
- **`handlers/`** — async entry points a queue consumer invokes per envelope (`libs/queue`). Same shape as a mutation.
- **`service.ts`** — exactly one per feature. Decorates mutations/views with `runInTx`/`runInOrgTx`, owns business rules, and is the only legitimate import target for facade code and other features' services. When the file grows uncomfortable, the split is by operation cluster, not by entity — `service/categorize.ts`, `service/reclassify.ts` is acceptable; `service/category.ts`, `service/result.ts` is not.
- **`error.ts`** — feature-local error hierarchy: an abstract feature-base extending `AppError`, plus concrete subclasses thrown by service methods.

Each mutation/view file is the smallest meaningful unit of database work — one query, one inferred type, one runner. `service.ts` is the only file that opens transactions and applies business rules. The five-entry shape rules out both the per-entity quartet pattern and the per-feature query bundle: every read or write is owned by the file that names the use case.

**Rule 6. Adapters never import features; features never import adapters.** Adapters communicate with features exclusively through queue envelopes — adapter ingress emits envelopes onto a topic; a consumer's handler consumes them; when a handler needs an outbound action it enqueues an envelope onto an egress topic that adapter egress consumes.

This is the constraint that makes the channel-agnostic claim in the product specification real. If the categorization feature imported `@repel/backend-adapters`, then categorization would only work for Gmail; adding iCloud would require changes inside categorization. The envelope is the lingua franca that lets each side evolve independently. `@repel/backend-adapters` and `@repel/backend-features` carry identical `type:lib` + `scope:backend` tags, so scope/type rules cannot separate them; instead they carry a third tag dimension — `area:adapter` and `area:feature` — and the mutual constraints `area:adapter ↛ area:feature` / `area:feature ↛ area:adapter` fail `nx lint` on any import crossing the boundary.

**Rule 7. The queue owns no business logic; consumers own only orchestration.** `libs/queue` contains the envelope type, the client (`enqueue`/`consume`), the Postgres transport, and the consumer runtime (claim, deliver, retry, dead-letter, drain) — and nothing about what any handler does. A consumer app's handler owns only orchestration: unpack the typed payload, open the tenant transaction, call a service, and (if downstream work is needed) `enqueue` the next envelope. Knowledge of what categorization does, what messaging does, or what an adapter's payload means beyond the envelope wrapper lives in features and adapters, never in the queue lib or the consumer's wiring.

The queue is replaceable infrastructure. If the application later moves from the Postgres-backed queue to an external system (Inngest, Temporal, RabbitMQ), `libs/queue`'s transport is what changes; handlers do not. Handlers are unit-testable without a queue: feed an envelope in, assert on the database state and on any envelopes the handler enqueued. The runtime is integration-testable separately against a fake transport.

(This rule replaces the former "the processing pipeline owns no business logic." That rule governed a `processing-pipeline/` directory of registry/topology/runner files that no longer exists — routing collapsed to a `topic` a consumer subscribes to, so there is no registry to map identifiers and no topology to fan out a handler's return value. The constraint it expressed — the carrier of async work holds no domain knowledge — now applies to `libs/queue` and the consumer apps.)

**Rule 8. Schemas are colocated with routes and commands.** Validation schemas live next to the route or command they validate. They do not live in a central `schemas/` directory.

This is a corollary of the file-based routing convention in §6. A route directory contains everything needed to serve the route: the handler, the schema, any reshape helpers. Centralized schemas create coupling at a distance — changing a route requires touching two locations — and they erode the ability to read a route directory and understand what it does without further navigation.

**Rule 9. Module boundaries are tag-enforced; every package declares its own dependencies.** Every workspace package carries Nx tags — `type:app|lib|cli`, `scope:backend|frontend|shared`, and (only on the two libs the adapter/feature boundary separates) `area:adapter|feature`. `@nx/enforce-module-boundaries` fails `nx lint` on any import that violates the constraints below; `@nx/dependency-checks` fails it on any import of a package the importer's own `package.json` does not declare. Both run in the pre-commit hook, so a violation cannot land.

| Source tag       | May depend only on               | Enforces                                          |
| ---------------- | -------------------------------- | ------------------------------------------------- |
| `type:app`       | `type:lib`                       | apps compose libs; app ↛ app                      |
| `type:lib`       | (not `type:app`, not `type:cli`) | Rule 1a — a lib never imports an app or the cli   |
| `type:cli`       | `type:lib`, `type:app`           | the developer toolbox may launch apps (`./start`) |
| `scope:shared`   | `scope:shared`                   | shared is isomorphic; imports nothing else        |
| `scope:backend`  | `scope:backend`, `scope:shared`  | backend ↛ frontend                                |
| `scope:frontend` | `scope:frontend`, `scope:shared` | frontend ↛ backend                                |
| `area:feature`   | (not `area:adapter`)             | Rule 6 — features ↛ adapters                      |
| `area:adapter`   | (not `area:feature`)             | Rule 6 — adapters ↛ features                      |

The `type:cli → type:app` edge is the single licensed app-import in the system, and it exists to launch: the cli imports an app's `./start` (its one public export) and calls it. `type:app ↛ type:app` is unchanged, so no app can import another app. `type:cli` is a distinct tag rather than a privileged `type:app` because the cli is not a deployable — it is short-lived developer tooling — and the boundary rule reads as a principle (the toolbox may reach anything) rather than a per-package exception.

The dependency-declaration half (Rule 9, second clause) is what makes the dependency graph honest: a package may not import `zod`, `pg`, or a sibling `@repel/*` lib that it resolves only because Bun hoisted it or it is installed globally — it must appear in that package's own `package.json`, or `nx lint` fails. Test-only dependencies (e.g. `pg` used only in a feature's tests) belong in that package's `devDependencies`; production imports must be in `dependencies`.

The `tsconfig.json` project-reference graph that `tsc --build` needs is **not** hand-maintained: `nx sync` generates each package's `references` from the dependency graph, and `nx sync:check` fails if they drift. The single exception is the root solution `tsconfig.json`, whose `references` list is still maintained by hand (the sync generator does not own it) — a new package must be added there.

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

## 7. Asynchronous Work and the Queue

Asynchronously triggered work flows through one queue lib, `libs/queue` (`@repel/backend-queue`). Short-lived operations (a CLI verb, a route handler) `enqueue` work; long-running consumer apps `consume` it. The queue is the seam between the two, and it is the only place that knows how envelopes are stored and moved.

**Client.** `enqueue(topic, payload, { dedupKey? })` writes an envelope to a topic; `consume(topic, handler, { concurrency?, pollInterval? })` binds a handler to a topic and runs it per delivered envelope. `topic` is a plain string — the stable, queue-implementation-independent concept. A duplicate `enqueue` against an in-flight `(topic, dedupKey)` is a no-op that returns a discriminated result rather than silently dropping the signal.

**Transport.** Today the transport is Postgres: one `job_queue` table with a `topic` column distinguishing logical queues. Dequeue uses `FOR UPDATE SKIP LOCKED`; rows move `pending → processing → completed | failed`, with attempts-remaining failures rescheduled with exponential backoff and exhausted ones dead-lettered. One shared table (not a table per topic) is deliberate: the mature Postgres-queue libraries converge on a single table with a name/topic column, and at least one reverted automatic per-queue tables after they caused connection-pooler pressure. The `topic`-as-column choice is internal to the transport — it does not leak into the `enqueue`/`consume` surface — which is what makes the eventual swap to an external system (SQS, RabbitMQ, Kafka, Inngest, Temporal) a transport replacement rather than a rewrite of every handler.

**Consumer runtime.** The runtime claims envelopes for a topic and delivers them one at a time to the handler under a tenant-scoped transaction keyed on the envelope's `orgId`. `start()` begins polling; `stop()` stops claiming new work, drains in-flight handlers, and resolves when drained. A consumer is hosted by an app (e.g. `apps/sync/sync-worker` calls `consume('sync', syncHandler)`), launched by `cli services run` (§3) — one consumer app per process in production.

**No router, no topology.** There is no registry mapping identifiers to handlers and no topology fanning a handler's return value out to next-handlers. A handler that needs downstream work calls `enqueue(topic, payload)` itself. This is sufficient while the async graph is small; an expressive routing layer is deferred until enough real multi-stage flows exist to design one against, and would be a new lib, not a resurrection of a per-node registry.

A handler is unit-testable without a queue: feed an envelope in, assert on the database state after it runs and on any envelopes it enqueued. The transport is mockable behind a single interface; the runtime is integration-testable against a fake transport. The first real async flow can run synchronously (a CLI verb that drives the work in-process) before it is moved behind the queue; moving it is a change of _how it is invoked_, not of the handler.

## 8. Adapters

An adapter is the translation layer between an external provider's protocol and the application's normalized envelope shape. Each provider gets its own directory under `adapters/`. A typical adapter directory contains:

```
adapters/gmail/
  ingress/                  # webhook receiver, history-list poller
  egress/                   # send-message via Gmail API
  normalize.ts              # provider payload → normalized envelope
  types.ts                  # provider-specific types
```

**Ingress.** The ingress side of an adapter receives data from the provider — by webhook, polling, or a long-lived connection — normalizes it into the application's envelope shape, and emits envelopes onto the queue. Ingress code does not import from `features/`. It speaks one language (the envelope contract) and that language is enough.

**Egress.** The egress side of an adapter consumes outbound-action envelopes from the queue. When a feature handler decides "send this message", it enqueues an envelope onto a `send-message` topic with a `providerAccountId` in the payload. The egress consumer picks up the envelope, looks up the provider account to determine which provider's adapter should handle it, and routes accordingly. This routing logic is the only place in the system that knows which providers exist.

**Normalize.** The normalization function maps the provider's payload shape into the application's normalized message shape. This is the place where Gmail's `threadId`, iCloud's `Message-ID` and `References` headers, and (eventually) LinkedIn's conversation identifiers are reduced to a uniform shape that downstream features can process without knowing which provider produced them.

The architectural commitment in the product specification — that async processing operates on normalized messages and is channel-agnostic — is realized by Rule 6 (adapters and features do not import each other) plus the egress routing pattern (the only code that knows which providers exist is the egress consumer). Adding a new provider is a new directory under `adapters/`, a new entry in the egress routing table, and (if the provider has unusual capabilities) zero or more new topics. It is never a change inside any feature.

## 9. Infrastructure

Infrastructure is a category (§4), not a directory. The provisioned things the application depends on today are the Postgres database and the asynchronous job queue; the code that talks to each is a backend lib, not a separate `infra/` tree. (This document describes code structure, not deployment — how these are provisioned and wired on a host is `docs/02-deployment-stack.md`'s concern, per §1.)

**`libs/db` (`@repel/backend-db`).** Contains the Kysely client, the `DB` interface that mirrors the SQL schema, the lazy-initialized runtime singleton, the transaction decorators (`runInOrgTx` for tenant-scoped mutations that activate row-level security via `SET LOCAL app.current_org_id`, and `runInTx` for unscoped operations like bootstrap), the migrations directory, and shared SQL helpers. The transaction decorators are the load-bearing abstraction here — every mutation and every handler runs inside one of them, which is what guarantees that transactions are short and that tenant isolation is enforced at the database level rather than relying on application discipline.

**`libs/queue` (`@repel/backend-queue`).** Contains the queue (§7): the envelope type, the `enqueue`/`consume` client, the Postgres transport (one `job_queue` table with a `topic` column), and the consumer runtime. The queue is not domain data — it is plumbing — and the table that backs it is opaque infrastructure, not something application code queries directly. Replacing the transport with an external system (SQS, RabbitMQ, Kafka, or a managed orchestration service) is the eventual evolution path; the design constraint is that nothing outside `libs/queue` knows which implementation is in use.

As more provisioned components enter the picture — a search index, a cache, a blob store — each gets its own backend lib. They are peers, not nested.

## 10. What This Document Does Not Decide

The document constrains the architecture and the vocabulary, but it deliberately leaves a number of decisions open for future tickets, sub-documents, or amendments. Listing them explicitly prevents the document from being interpreted as having opinions it does not have.

The long-term queue implementation is open. The starting transport is decided — a hand-rolled `job_queue` table in Postgres (§7, ADR-004) — but whether the application later moves to a library such as pg-boss or an external service such as Inngest or Temporal is deferred. Because the swap is confined to `libs/queue`'s transport and never reaches a handler, deferring it costs nothing.

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

The existence of a third multi-stage asynchronous flow is the trigger to consider whether the direct-`enqueue` chaining of §7 should be replaced by an explicit routing layer (a new lib), rather than each handler naming its own next topic.

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

**`migrations` — NO.** Infrastructure. Lives in `libs/db` (`@repel/backend-db`), not under `features/`. There is no user-facing surface for migrations and no engineer would meaningfully "own" them as a product capability.

**`bootstrap` — NO.** Bootstrap is a single mutation inside `features/accounts/` that creates the first organization and the first user atomically. It is one operation, not a coherent capability. Cross-feature seed and demo routines that do more than bootstrap (creating an org, attaching provider accounts, ingesting a fixture mailbox) live at the facade level, not inside any feature.

**`async jobs` / `queue` — NO.** Plumbing. The queue (`libs/queue`) is the carrier of asynchronous work. The work it carries — categorization, draft generation, automation firing — belongs to the features that own the outcomes, run by consumer apps. The carrier is not a feature.

The pattern that emerges from these examples is the following. If the candidate is a noun for data — threads, attachments, contacts, messages — it is almost never a feature; it is part of whichever feature owns the data. If the candidate is a verb the product performs — categorize, search, send — or a coherent capability the product offers — messaging, accounts, preferences — it usually is a feature. When uncertain, the safer default is to start as a sub-area inside an existing feature; promotion later, when the sub-area earns its own boundary, is cheaper than demotion when an over-eager feature directory turns out to have been an entity in disguise.

A sub-area is not a feature. It does not get its own `service.ts` or `error.ts`; it lives inside the parent feature's files. Promoting a sub-area to a feature is the act of giving it the structure described in Rule 5.

## Further Reading

For the intellectual lineage of the decisions in this document — vertical slice architecture, lowercase CQRS, functional core / imperative shell, the case for SQL-as-authorship, the historical critique of object-relational mapping, the Postgres-specific tools that make the "database as participant" principle realizable, and the counterweight literature on aggregates and bounded contexts — see `docs/reading-list/db-design/`. The reading list is not required to use this document; it is for contributors who want to understand why the architecture takes the shape it does.
