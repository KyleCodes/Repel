# Deployment and Technology Stack

## Infrastructure

### Runtime Environment

Bare metal VM, self-hosted. No cloud provider dependency. The application runs on a home server accessible via VPN (Tailscale/WireGuard). No publicly routable endpoint.

### Implications

- No cloud-managed databases, queues, or blob storage. Everything runs locally.
- No push notifications from providers (Gmail Pub/Sub requires a public webhook endpoint). Polling is the ingress strategy.
- Deployment is docker-compose on the VM. No container orchestration, no CI/CD pipeline beyond `git pull && docker compose up`.
- Backups are the operator's responsibility (pg_dump, filesystem snapshots, rsync to secondary server).

## Technology Stack

### Backend

| Component      | Technology                          |
| -------------- | ----------------------------------- |
| Language       | TypeScript                          |
| Runtime        | Bun                                 |
| Framework      | Express                             |
| Database       | PostgreSQL 16, self-hosted          |
| Queue          | Postgres-backed (`SKIP LOCKED`)     |
| LLM            | Anthropic API (Claude) / OpenAI API |
| CLI            | Commander.js                        |
| Test framework | bun test (built-in)                 |

### Frontend

| Component     | Technology                       |
| ------------- | -------------------------------- |
| Framework     | React (client-side SPA)          |
| Build tool    | Vite 8                           |
| Routing       | TanStack Router                  |
| Data fetching | TanStack Query                   |
| Global state  | Zustand (auth/session, UI prefs) |
| API protocol  | REST (plain HTTP fetch)          |

No SSR. No Next.js. No Redux. No GraphQL. No tRPC.

### Infrastructure

| Component        | Technology                        |
| ---------------- | --------------------------------- |
| Containerization | Docker, docker-compose            |
| Reverse proxy    | None (direct port access via VPN) |
| VPN              | Tailscale or WireGuard            |
| Blob storage     | Local filesystem                  |
| Secrets          | Environment variables             |

### Monorepo

| Component         | Technology                    |
| ----------------- | ----------------------------- |
| Workspace manager | Bun workspaces                |
| Type sharing      | Zod schemas in shared package |
| Type checking     | TypeScript project references |
| Task runner       | Makefile                      |

## Deployment Model

The deploy target is one VM running Docker Compose. There is no cloud control plane and no synthesis step — the `docker-compose.yml` (plus environment override files) **is** the deployable artifact. The CDK instinct of "declare resources in a stack and synth them" maps to flat Compose primitives:

| CDK concept                    | Compose equivalent                                         |
| ------------------------------ | ---------------------------------------------------------- |
| Stack                          | a `docker-compose` file / fragment (one per stack folder)  |
| Resource declaration           | a service block                                            |
| Logical id / `Ref`             | the service name (its DNS name on the Compose network)     |
| `GetAtt` (an address/endpoint) | `${SERVICE}:PORT`, injected into a container as an env var |
| Environment-specific synth     | a `docker-compose.override.yml` / per-env override file    |

**Resource addressing.** Services reach each other by service-name DNS on the shared Compose network (`postgres:5432`, never a hardcoded IP — Compose reassigns container IPs on restart). Connection strings and secrets are injected as **runtime** env vars (via `environment:` / `env_file:`), not baked into images at build time.

**One container per process.** Each app (§ Backend) is its own Compose service, launched by `cli services run <name>` so config/env resolution is identical to development. There is no `MODE` switch, no generic worker host, and no Kubernetes — an orchestrator scheduling onto a single VM would be all overhead. If a thin deploy wrapper is ever wanted (rolling restarts, SSH-based deploys), Kamal sits one step past raw Compose without a control plane; that is a future option, not a current dependency. Terraform, if used at all, is scoped to provisioning the VM itself and lives outside the Nx graph.

## Docker Compose Profiles

### `dev` Profile

Runs infrastructure services only. The application runs as bare processes on the host for hot reload, debugger attach, and fast iteration.

Services started: `postgres`

Developer workflow:

```
docker compose --profile dev up -d
bun run cli services run api      # terminal 1 — one app, CLI-resolved env
bun run dev:web                   # terminal 2
```

The cli (`@repel/backend-cli`, tagged `type:cli`) is the launcher. `cli services run <name>` resolves config, renders the env a service needs, and calls that app's exported `start()` (ADR-003, ADR-016). `cli services run --all` runs every registered app's `start()` in **one process** — a single event loop and a single step-debugger spanning the whole backend (the replacement for the old `MODE=all`). There is no per-app `package.json` run script and no `MODE` switch.

### `full` Profile

Runs everything. Used for "production" deployment on the home server and for validating containerized behavior. Each backend app is its own service (one container per process), each launched via `cli services run <name>`; services in a stack (e.g. `apps/sync/`) are deployed together by that stack's compose fragment.

Services started: `postgres`, `api`, `sync-worker`, … (one per deployable app)

Deployment workflow:

```
docker compose --profile full up -d
```

## Authentication and Credential Storage

### Provider Auth (MVP Approach)

For the initial single-user self-hosted deployment, provider authentication is kept minimal:

- **Gmail**: obtain client ID and client secret from Google Cloud Console. Perform the OAuth token exchange manually once (hit consent URL, grab refresh token, store in DB or env). No OAuth flow UI in the app.
- **iCloud**: app-specific password generated from Apple ID settings. A single string stored in env or DB.

A full OAuth flow with in-app consent screens is deferred until multi-user support is needed.

### Credential Storage

OAuth tokens and app-specific passwords are stored in `provider_account.credentials_encrypted` as a `bytea` column.

- Encryption is **application-side AES-256-GCM** (`lib/crypto/encryption.ts`), not DB-side `pgcrypto`. The app encrypts before the bytes reach Postgres, so the database only ever holds ciphertext and never sees the key — keeping a DB-only or backup leak non-catastrophic, and adding no external Postgres-extension dependency to the self-hosted image. The stored blob is `iv(12) || authTag(16) || ciphertext`; GCM makes it tamper-evident.
- The 32-byte key is injected as the `ENCRYPTION_KEY` env var (hex-encoded), the same in every environment. Generate one with `repel db encryption generate-key`. There is no plaintext-in-development mode.

The credential blob is a JSON object whose shape varies by `auth_method`:

```json
// oauth2
{ "access_token": "...", "refresh_token": "...", "expires_at": "..." }

// app_password
{ "password": "..." }

// api_key
{ "key": "..." }
```

The channel adapter for each provider is responsible for interpreting the credential shape.

## Gmail Ingress Strategy

Gmail API with `users.history.list` for incremental sync. Polling interval: 60–120 seconds. The `sync_cursor` column on `connected_account` stores the Gmail `historyId` as a JSON value.

OAuth2 credentials are obtained via Google Cloud Console (personal project, not published). Scopes: `gmail.readonly`, `gmail.send`, `gmail.modify`.

## iCloud Ingress Strategy

IMAP with app-specific password. No official Apple API exists for iCloud Mail. The `sync_cursor` stores the last seen IMAP UID per folder.

Thread resolution is manual: parse `References` and `In-Reply-To` headers from each message to reconstruct thread chains.

## LLM Integration

LLM calls go to hosted APIs (Anthropic, OpenAI) over the internet. This is the one external dependency that requires network egress from the VM. No local model hosting initially.

The LLM executor is a stateless lib (`src/lib/llm.ts`) shared across features (classification, automations, chat). Model selection and API keys are configured via env vars.

## Blob Storage

Attachments are stored on the local filesystem under a configurable root directory (`BLOB_STORAGE_ROOT`, default `./data/blobs`). File paths are stored in the database. The directory structure is:

```
data/blobs/{org_id}/{message_id}/{filename}
```

This layout makes it straightforward to migrate to an object store (S3-compatible, MinIO) later by swapping the storage backend without changing the database schema.

## Backup Strategy

- **Database**: `pg_dump` on a cron schedule, stored locally and synced to a secondary server.
- **Blobs**: rsync to secondary server.
- **Config/Secrets**: operator-managed, not stored in the application.
