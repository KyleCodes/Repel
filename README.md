# Repel

Self-hosted AI inbox — aggregates email and messaging channels, classifies and summarizes messages, drafts replies, and surfaces what matters.

## What it does

- Pulls messages from connected provider accounts (Gmail, iCloud, and more)
- Classifies, tags, and scores messages for importance using an LLM pipeline
- Surfaces a unified feed with draft replies ready for review
- Supports multiple channels: email, SMS, DM, chat rooms (initial provider support: Gmail, iCloud, generic IMAP)

## Stack

| Layer          | Choice                                          |
| -------------- | ----------------------------------------------- |
| Runtime        | Bun                                             |
| Language       | TypeScript                                      |
| Database       | PostgreSQL (with RLS for tenant isolation)      |
| Query builder  | Kysely                                          |
| HTTP framework | Express                                         |
| Frontend       | React + Vite + TanStack Router + TanStack Query |
| CLI            | Commander                                       |
| Migrations     | node-pg-migrate                                 |

## Repo structure

```
packages/
  backend/
    apps/       — deployables: api, cli, worker
    libs/       — importable: features, adapters, db, transport, crypto, env
  frontend/
    apps/       — deployables: web (React SPA)
    libs/       — importable FE libs (none yet)
  shared/       — isomorphic libs: enums, http, errors, slug
docs/
  context/      — Domain knowledge, ADRs, git conventions
  summaries/    — Session handoffs and decision records
```

## Getting started

```bash
# Start Postgres
docker compose up -d

# Run migrations
bun run cli db migrations up

# Bootstrap the first org and user
bun run cli bootstrap --org-name "My Org" --email you@example.com

# Start the API (each backend app is launched directly via its main.ts)
bun run packages/backend/apps/api/src/main.ts
```

## Architecture decisions

See [`docs/context/adr/index.md`](docs/context/adr/index.md) for the full list of ADRs covering data storage, multi-tenancy, transaction boundaries, domain layout, and frontend choices.
