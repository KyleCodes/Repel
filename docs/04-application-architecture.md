# TypeScript Application Architecture

> **Drift notice (2026-04-22):** This document is being incrementally aligned with the post-REP-9 codebase. The Project Structure, Database Layer, and Entrypoints sections below reflect the current shape. Sections describing the channel adapter, pipeline, agent, and API route layers describe the v1 *target* shape and have not yet landed — those sections will be rewritten under a follow-up ticket as those layers come online.

## Overview

A TypeScript monorepo with Bun workspaces. Three packages: a shared type/schema library, a backend server, and a frontend SPA. The backend is a monolith with multiple entrypoints (server and CLI). The frontend is a client-side rendered React app backed by TanStack Router and TanStack Query.

## Project Structure

Current shape (post-REP-9):

```
repel/
├── package.json
├── bun.lock
├── tsconfig.json
├── Makefile
│
├── packages/
│   └── shared/                  # @repel/shared
│       └── src/
│           ├── enums.ts         # Channel, Provider, AuthMethod, MessageDirection, UserRole
│           └── index.ts
│
├── apps/
│   ├── server/                  # @repel/server
│   │   └── src/
│   │       ├── main.ts
│   │       ├── cli.ts
│   │       ├── db/
│   │       │   ├── client.ts    # makeDb() — Kysely + pg.Pool factory
│   │       │   ├── runtime.ts   # getDb() lazy singleton + closeDb()
│   │       │   ├── tx.ts        # runInOrgTx / runInTx decorators (ADR-010)
│   │       │   ├── repos.ts     # makeRepos(q) — bundles every context repo
│   │       │   ├── types.ts     # Kysely DB interface + row aliases
│   │       │   ├── migrations/
│   │       │   └── __tests__/
│   │       ├── core/            # bounded contexts (ADR-009)
│   │       │   ├── org/         # {repo,service,types,mappers}.ts
│   │       │   ├── user/
│   │       │   ├── account-setup/  # cross-cutting bootstrap flow (runInTx)
│   │       │   └── acme/        # reference vertical — see header comment in service.ts
│   │       ├── api/
│   │       │   └── router.ts    # Express setup + /api X-Org-Id middleware
│   │       └── domains/
│   │           └── dev-db/      # peer to core/ — dev-only branch DB lifecycle CLI
│   │
│   └── web/                     # @repel/web
│       ├── vite.config.ts
│       ├── index.html
│       └── src/
│           ├── main.tsx
│           ├── routes/
│           │   ├── __root.tsx
│           │   ├── index.tsx
│           │   ├── threads/
│           │   │   └── $threadId.tsx
│           │   └── settings/
│           │       └── index.tsx
│           ├── hooks/
│           │   ├── use-threads.ts
│           │   ├── use-messages.ts
│           │   └── use-accounts.ts
│           ├── api/
│           │   ├── threads.ts
│           │   ├── messages.ts
│           │   └── accounts.ts
│           ├── components/
│           │   ├── thread-row.tsx
│           │   ├── message-detail.tsx
│           │   └── command-palette.tsx
│           ├── stores/
│           │   ├── auth.ts
│           │   └── ui.ts
│           └── lib/
│               ├── format-date.ts
│               └── query-client.ts
│
├── docker-compose.yml
└── data/
    ├── pg/
    └── blobs/
```

## Backend

### Entrypoints

A single codebase produces two binaries: server and CLI. Both share all business logic.

**Server** (`main.ts`): runs in one of three modes controlled by `MODE` env var (`api`, `worker`, `all`). Worker is currently a stub; the sync scheduler will be folded into worker mode when it lands. Connection lifecycle is managed lazily via `getDb()` in `db/runtime.ts` — no pool is opened until the first call.

`MODE=all` runs everything in a single process (development and initial "production"). Individual modes exist for future separation if any component needs independent scaling.

**CLI** (`cli.ts`): non-HTTP interface to the same business logic. Every command with side effects supports `--dry-run`. Commands are registered by their owning bounded context (e.g. `core/account-setup/cli.ts` registers `bootstrap`; `domains/dev-db/cli.ts` registers `db {clone,drop,refresh-template}`). The CLI calls `closeDb()` in a `finally` block so the process exits cleanly when work completes (without it, pg's pool would keep the process alive until the idle timeout drains, ~10s).

### Database Layer

`db/client.ts` exposes `makeDb()` which constructs a Kysely instance over a `pg.Pool` against `DATABASE_URL`. `db/runtime.ts` exposes `getDb()` (a lazy process-level singleton over `makeDb()`) and `closeDb()` (for entrypoint teardown).

`db/repos.ts` exposes `makeRepos(q: DbExecutor)` which builds a fresh `Repos` bundle (one factory-built repo per bounded context) bound to whatever executor it's given — either the singleton `Db` for read-only contexts or the `Transaction<DB>` inside a tx. Adding a new bounded context = adding one entry here.

Transaction ownership lives in `db/tx.ts` (per ADR-010, rewritten 2026-04-18). All transaction management goes through two decorators:

- `runInOrgTx(fn)` — for tenant-scoped service methods. Opens a transaction, sets `app.current_org_id` via `SET LOCAL` for RLS, builds `Repos` over the trx, and runs the wrapped function under an `AsyncLocalStorage` frame so nested decorated calls join the same transaction. Compile-time `OrgScoped<A>` constraint requires every input to carry an `orgId`.
- `runInTx(fn)` — for unscoped flows that create the org itself (bootstrap). No `SET LOCAL`. Runtime guards in both decorators reject cross-tenant joins and RLS-bypass attempts.

Services are module-level singletons (per ADR-009 amendment, 2026-04-18) — no `makeXService(repos)` factories. Cross-service composition inside a `runInTx` flow uses sibling `*Impl` exports of the undecorated functions; trivial methods inline their `runInOrgTx` lambdas without lifting a named impl.

Transport layers (HTTP, GraphQL, CLI) **never import `runInOrgTx` or `runInTx`** — they call service singletons directly. Migrations are raw SQL files in `db/migrations/` (node-pg-migrate format with `-- Up Migration` / `-- Down Migration` markers), applied in order by filename. No ORM.

### Channel Adapters

Each channel/provider pair implements the `ChannelAdapter` interface:

```typescript
interface ChannelAdapter {
  readonly channel: Channel;
  readonly provider: Provider;
  sync(account: ConnectedAccount): AsyncGenerator<IngressMessage>;
  send(account: ConnectedAccount, draft: DraftReply): Promise<void>;
}
```

Adapters handle I/O only — fetching from and sending to the provider. Thread resolution is delegated to pure functions in `channels/lib/threading.ts`.

The sync scheduler iterates active `connected_account` rows, instantiates the appropriate adapter, calls `sync()`, inserts normalized messages + raw payloads, enqueues processing jobs, and updates `sync_cursor`. All within a single transaction per message.

### LLM Executor

The LLM executor is a lib, not a service or a separate process. It lives at `src/lib/llm.ts` and is a stateless function: prompt in, response out.

```typescript
interface LlmRequest {
  model: string;
  systemPrompt: string;
  userContent: string;
  responseFormat?: 'text' | 'json';
}

interface LlmResponse {
  content: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

async function execute(req: LlmRequest): Promise<LlmResponse> { ... }
```

The async/sync distinction lives in the caller, not the executor:

- **Async (queued):** the pipeline worker dequeues a job, calls `execute()`, writes results to DB. Used by classification, summarization, draft reply generation.
- **Sync (request-response):** an API route handler calls `execute()` directly and streams or returns the response. Used by the chat interface.

Multiple features share the executor: classification pipeline, automation workflows, chat interface. Each builds its own prompts, calls `execute()`, and handles results in its own execution context. The executor doesn't know or care about the caller's lifecycle.

### Processing Pipeline

`queue.ts` provides `enqueue(queue, payload)` and `dequeue(queue, workerId)` functions backed by the `job_queue` table using `FOR UPDATE SKIP LOCKED`.

`worker.ts` is a poll loop that calls `dequeue()`, dispatches to the appropriate processor, and calls `ack()` or `fail()`. Poll interval is configurable (default 1 second).

Processors implement individual processing steps. A single job may invoke multiple processors in sequence:

1. `classify.ts` — categorize, tag, score importance
2. `summarize.ts` — generate plain-language summary (conditional on classification)
3. `draft-reply.ts` — draft a response (conditional on classification indicating a reply is needed)

This is a single-job pipeline, not separate queue entries per step. The classify result determines which subsequent steps run. All processors call the LLM executor from `src/lib/llm.ts`.

### API

Express router mounting route modules. Each route file defines handlers for a resource:

- `threads.ts` — list, get, delete, bulk delete
- `messages.ts` — list, get, delete, query by category/tag/account/text
- `accounts.ts` — list, add, remove, trigger sync
- `digests.ts` — list digest topics, get digest content
- `chat.ts` — conversational interface, calls LLM executor synchronously

Route handlers call into the DB layer directly (no service layer abstraction at this stage). Query building uses pure functions from `api/lib/filters.ts`. Pagination uses cursor-based encoding via `api/lib/pagination.ts`.

## Frontend

### Stack

- **React** — client-side rendered SPA. No SSR.
- **Vite** — dev server with HMR and production builds. Executed via Bun.
- **TanStack Router** — type-safe routing with file-based route definitions.
- **TanStack Query** — all data fetching. Handles caching, refetching, loading/error states.
- **Zustand** — minimal global state: auth/session, UI preferences (sidebar state, theme).
- **REST** — plain HTTP fetch against the backend API. No GraphQL, no tRPC.

### Data Fetching Pattern

Every API resource gets a typed fetch function in `api/` and a TanStack Query hook in `hooks/`:

```typescript
// api/threads.ts
import type { ListThreadsQuery, ListThreadsResponse } from '@mailbox/shared';

export async function listThreads(params: ListThreadsQuery): Promise<ListThreadsResponse> {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([_, v]) => v !== undefined) as [string, string][]
  );
  const res = await fetch(`/api/threads?${qs}`);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

// hooks/use-threads.ts
import { useQuery } from '@tanstack/react-query';
import { listThreads } from '../api/threads';
import type { ListThreadsQuery } from '@mailbox/shared';

export function useThreads(params: ListThreadsQuery) {
  return useQuery({
    queryKey: ['threads', params],
    queryFn: () => listThreads(params),
  });
}
```

Components consume hooks directly. No intermediate state management layer:

```tsx
function ThreadList() {
  const { data, isLoading, error } = useThreads({ limit: 50 });
  if (isLoading) return <Loading />;
  if (error) return <Error error={error} />;
  return <ul>{data.threads.map(t => <ThreadRow key={t.id} thread={t} />)}</ul>;
}
```

### Global State

Zustand stores are limited to genuinely global concerns:

```typescript
// stores/auth.ts
interface AuthState {
  user: User | null;
  setUser: (user: User | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
}));
```

If TanStack Query can own it (server data, loading states, cache), it does. Zustand only holds client-only state that doesn't come from the API.

## Data Flow

### Ingress

```
Provider → Adapter.sync() → IngressMessage
  → BEGIN transaction
    → INSERT message
    → INSERT message_raw
    → INSERT job_queue (status: pending)
    → UPDATE connected_account.sync_cursor
  → COMMIT
```

### Processing

```
Worker.dequeue() → job_queue row
  → classify(message) → LLM executor → INSERT message_classification, message_tag, message_importance
  → if needs_summary: summarize(message) → LLM executor → INSERT message_summary
  → if needs_reply: draftReply(message) → LLM executor → INSERT draft_reply
  → ack(job)
```

### Egress

```
User approves draft in UI → API receives send request
  → Adapter.send(account, draft) → provider delivers message
  → UPDATE draft_reply.status = 'sent'
  → INSERT message (direction: outbound)
```

### Chat (Sync)

```
User sends message in chat UI → POST /api/chat
  → route handler calls LLM executor directly (no queue)
  → LLM executor returns response
  → stream or return to client
```

## Build and Deploy

### Development

```bash
docker compose --profile dev up -d
bun run dev:server    # terminal 1: backend with hot reload
bun run dev:web       # terminal 2: frontend with HMR
```

### Production Build

```bash
bun build --compile apps/server/src/main.ts \
  --outfile dist/mailbox-server \
  --target bun-linux-x64 --minify --sourcemap=linked

bun build --compile apps/server/src/cli.ts \
  --outfile dist/mailbox-cli \
  --target bun-linux-x64 --minify

cd apps/web && bunx --bun vite build
```

### Deployment

```bash
scp dist/mailbox-server dist/mailbox-cli user@homeserver:~/mailbox/
scp -r apps/web/dist/ user@homeserver:~/mailbox/web/
```

Server binary serves static frontend assets directly via Express static middleware.

## Docker Compose

```yaml
services:
  postgres:
    image: postgres:16
    volumes:
      - ./data/pg:/var/lib/postgresql/data
    environment:
      POSTGRES_DB: mailbox
      POSTGRES_USER: mailbox
      POSTGRES_PASSWORD: dev
    ports:
      - "5432:5432"
    profiles: [dev, full]

  app:
    build: .
    environment:
      MODE: all
      DATABASE_URL: postgres://mailbox:dev@postgres:5432/mailbox
      ENCRYPTION_KEY: ${ENCRYPTION_KEY}
    depends_on: [postgres]
    ports:
      - "3000:3000"
    profiles: [full]
```
