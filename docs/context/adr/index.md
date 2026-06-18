# ADR Index

| ID      | Title                                                             | Domain                                    | Status   | Path                                                                |
| ------- | ----------------------------------------------------------------- | ----------------------------------------- | -------- | ------------------------------------------------------------------- |
| ADR-001 | PostgreSQL over NoSQL                                             | data-storage                              | Accepted | docs/context/adr/ADR-001-postgres-over-nosql.md                     |
| ADR-002 | All Tables Are Org-Scoped with RLS                                | data-storage, multi-tenancy               | Accepted | docs/context/adr/ADR-002-all-tables-org-scoped.md                   |
| ADR-003 | Single Monolith, Multiple Entrypoints                             | deployment, architecture                  | Accepted | docs/context/adr/ADR-003-single-monolith-multiple-entrypoints.md    |
| ADR-004 | Postgres-Backed Job Queue                                         | data-storage, infrastructure              | Accepted | docs/context/adr/ADR-004-postgres-backed-job-queue.md               |
| ADR-005 | Provider Account Vocabulary                                       | architecture, extensibility, data-storage | Accepted | docs/context/adr/ADR-005-provider-account-vocabulary.md             |
| ADR-006 | Classifier Config as Versioned Database Rows                      | data-storage, ai-pipeline                 | Accepted | docs/context/adr/ADR-006-classifier-config-versioned-rows.md        |
| ADR-007 | LLM Executor as a Shared Lib                                      | architecture, ai-pipeline                 | Accepted | docs/context/adr/ADR-007-llm-executor-shared-lib.md                 |
| ADR-008 | Client-Side SPA with TanStack Stack                               | frontend, architecture                    | Accepted | docs/context/adr/ADR-008-client-side-spa-tanstack.md                |
| ADR-009 | Vertical Feature Layout                                           | architecture, data-access                 | Accepted | docs/context/adr/ADR-009-vertical-feature-layout.md                 |
| ADR-010 | Transaction Ownership via runInOrgTx / runInTx Decorators         | architecture, data-access, multi-tenancy  | Accepted | docs/context/adr/ADR-010-transaction-boundaries-withtx-withOrgtx.md |
| ADR-011 | CamelCasePlugin — TypeScript camelCase, DB snake_case             | data-access, conventions                  | Accepted | docs/context/adr/ADR-011-camelcase-plugin-ts-snake-db.md            |
| ADR-012 | CLI Structure — handler + sibling `schemas/`                      | conventions, architecture                 | Accepted | docs/context/adr/ADR-012-cli-structure-namespace-and-schemas.md     |
| ADR-013 | User-Scoped Feeds — Org-Only RLS Now, User Dimension Denormalized | data-storage, multi-tenancy, data-access  | Accepted | docs/context/adr/ADR-013-user-scoped-feeds-org-rls.md               |
| ADR-014 | Credential Encryption at Rest — App-Side AES-256-GCM              | data-storage, infrastructure              | Accepted | docs/context/adr/ADR-014-credential-encryption-at-rest.md           |
| ADR-015 | Module Public Contract via the `exports` Map — No Barrel Files    | architecture, conventions                 | Accepted | docs/context/adr/ADR-015-module-public-contract-exports-map.md      |

## Domain Tags

`data-storage` · `multi-tenancy` · `deployment` · `infrastructure` · `architecture` · `extensibility` · `ai-pipeline` · `frontend` · `data-access` · `conventions`
