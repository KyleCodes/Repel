# Decision Record: DR-REP-56-1 — Sync Schema + Synchronous Persistence

**Ticket:** REP-56 — [Sync] Schema + synchronous persistence + sync status
**Date:** 2026-06-22
**Status:** Accepted
**Depends on:** REP-50 (message schema), REP-52 (Gmail ingest/normalize), REP-55 (sync run POC / `libs/sync`), REP-60 (apps/libs restructure)
**Blocks:** REP-57 (async runner: job_queue enqueue + worker)

## Context

REP-55 proved the Gmail adapter's `ingest()` runs against a real account and drives
a per-event handler, but the only handler (`logSink`) wrote nothing. REP-56 adds the
durable persistence core: the schema for sync jobs/tasks/events, the FK anchoring
`message_raw` to its provenance, and a persisting handler that turns the adapter's
event stream into a real message graph. The `features/sync` service is
invocation-agnostic — REP-57 wires it onto the queue without rewriting persistence.

## Decisions

### D1 — Three tables: `sync_job`, `sync_task`, `sync_task_event`

A job is one unit of sync work (org/user); a task drives one provider account's
ingest stream; an event is one entry in a task's lifecycle log. uuid (v4) surrogate
PKs on all three, consistent with every existing table. No composite
`(job_id, task_id)` PK — ADR-002 rejected scoping-column composite PKs (they widen
every FK for no safety gain); `sync_task.job_id` already serves "task knows its job."

### D2 — Append-only event log is the single source of truth; all state is derived

`sync_job` and `sync_task` carry **no** status/processed/cursor columns. Per-task
outcome and per-job verdict are **derived** from the `sync_task_event` log via
app-side Kysely views (`features/sync/views/get-sync-result`, `get-sync-job-result`),
never read off a mutated entity. This is the load-bearing decision: it makes moving
event-writing to an async worker (REP-57) safe — the worker only `INSERT`s; no status
column can lag behind or disagree with the events. (Textbook event-sourcing: scope
events to one aggregate, derive the parent. Manifesto §10 anticipates exactly this.)

### D3 — Events are task-scoped; the table is `sync_task_event`

Every event belongs to exactly one task (`task_id NOT NULL`); the task is the
aggregate / ordered stream. The name encodes the invariant (it is not a general
"sync event"). **One `enqueued` event per task**, not per job — there are no
job-level events; job state is the aggregate of its tasks' streams. `sync_task_event.type`
slugs are identical to the adapter's `AdapterEvent.type` plus a caller-authored
`enqueued`: `enqueued | started | auth | progress | message | completed | failed`.
App and storage vocabularies are identical — no remapping.

`type` is a **Postgres enum** (`sync_event_type`), created from `SyncEventType`
in `@repel/enums` (the `pgm.createType('...', Object.values(...))` pattern from
rep-9), so the `SyncEventType` union reaches `generated.ts` and code references
`SyncEventType.<slug>` rather than string literals. (PR #31 review: replaced the
original `text` + CHECK with the enum.) The derived statuses (`SyncTaskStatus` /
`SyncJobStatus`) are also `@repel/enums` consts, but **not** pg enums — they are
computed from the event log and never stored.

### D4 — `user_id NOT NULL` on all three tables (ADR-013)

Denormalized from the job's `userId` (job → task → event), mirroring
`message`/`thread`/`provider_account`, so future user-scoped RLS is a flat-cost
`ALTER POLICY` with no backfill. Tables are empty at creation, so it is free.
org-scoped RLS (ADR-002) `tenant_isolation` USING-only policy on each table.

### D5 — `provider_account.sync_cursor` dropped; cursor lives in the event log

The pre-existing `provider_account.sync_cursor` column is **dropped** this migration.
The resumption cursor now lives only in the `completed` event's payload
(`{ cursor, processed }`); the next sync derives its resume point by reading the
latest `completed` `sync_task_event` for the provider_account (via the `sync_task`
join). No denormalized copy to keep consistent — same append-only-log-is-truth model
as D2. Consequence: there are **no terminal-specific mutations** —
`completeSyncTask`/`failSyncTask` do not exist; the terminal `completed`/`failed`
events are ordinary `persistEvent` calls. One mutation handles the whole non-message
lifecycle.

> **Follow-up (not yet a ticket):** the incremental-sync read path (REP-53/REP-57)
> needs a `getResumeCursor` view + wiring into the spec builder. REP-56 only writes
> the cursor (into the event); reading it back is the consumer's job.

### D6 — `persistMessage` is idempotent via `ON CONFLICT DO NOTHING`

`message_raw` has `UNIQUE (provider_account_id, external_message_id)` (REP-50). The
raw insert uses `ON CONFLICT DO NOTHING`; on a resync of an already-persisted message
the graph write is skipped (noop) while the `message`-type `sync_task_event` is
**still** written (referencing the existing raw row), so the audit log records every
sighting. Verified live: a second `sync run --limit 5` left `message_raw`/`message`/
`message_participant` counts unchanged while `message`-type events grew 5→10.

> **Trade-off:** DO NOTHING means a resync never refreshes an edited upstream message.
> Correct for v0 capped full-sync; upsert semantics deferred to REP-53.

### D7 — `message_raw.provider_account_id` is KEPT

It is half the dedup unique key (D6) — load-bearing for idempotency, not droppable.
This resolves the long-standing keep-vs-drop question (REP-21 comments): the
`sync_task` chain cannot dedup across syncs (each sync is a new task), so the column
stays. It is not pure denormalization.

### D8 — DB-first types; the adapter→DB mapping lives in `libs/sync`

Everything persisted is typed from `generated.ts` (kysely-codegen) via
`Insertable`/`Selectable`/`Omit`/`InferResult`. `features/sync` (`area:feature`) must
NOT import `@repel/backend-adapters` (`area:adapter`) per Rule 6, so its
`persistMessage` input is DB-derived (`Omit<Insertable<Message>, …>` etc.), NOT the
adapter's `NormalizedMessage`. The `AdapterMessageEvent → PersistMessageInput` mapping
lives in `@repel/backend-sync`'s persisting handler, which is legally adapter-aware.

This also resolves the REP-56 comment's "message-shape ownership: DB-first vs
domain-first" — **DB-first**. The type-only `adapters → @repel/backend-db/generated`
edge (`adapters/src/types.ts`, the `Omit<Insertable<DbRow>>` derivations) is
**intentional and exempt**: the `area:` eslint rules govern runtime deps, and a
type-only import of the generated schema is the sanctioned DB-first edge. No separate
contracts package; no domain-types layer.

### D9 — One persisting handler; `logHandler` dropped

REP-55's `SyncEventSink`/`onEvent`/`logSink` are renamed to
`SyncEventHandler`/`handle`/`persistingHandler`. The log-only sink is **deleted** —
the POC is done; `persistingHandler` logs AND persists. `runSyncJob`'s seam renames
`{ sink }` → `{ handler }`, default `persistingHandler`. `libs/sync` reaches the DB
only through `@repel/backend-features` — it does NOT depend on `@repel/backend-db`.

> **Boundary note:** that `libs/sync ↛ @repel/backend-db` constraint is enforced
> ONLY by omitting the dep from `libs/sync/package.json` — there is no eslint
> depConstraint for it (`libs/sync` is `scope:backend` with no `area:` tag, so the
> Rule 6 wall does not apply). A hard rule would need an `area:` tag on `libs/sync`
> plus a new depConstraint — out of scope for REP-56.

### D10 — Skeleton persisted before ingest

`message_raw.sync_task_id` and `sync_task_event.task_id` are NOT NULL FKs to
`sync_task`, so `runSyncJob` persists the whole skeleton (job + tasks + per-task
`enqueued` events, one CTE) **before** the ingest fan-out. The CLI-generated uuids
are passed as the row PKs, so the in-memory `SyncTask.id` IS the persisted id —
`ctx.syncTask.id` resolves the FK with no read-back.

### D11 — Executor-caught failures persist a terminal `failed` event

Surfaced by live testing (expired refresh token): when `ingest()` throws or ends
with no terminal event, the adapter emits no `failed` event, so the log would end at
`started` and `sync_result` would derive `running` for a task that failed. The
executor's catch now writes a terminal `failed` event itself (best-effort, through
the `syncService` seam) so the derived status is correct.

### D12 — v0 write-path defaults (ASSUMED)

- `message.direction = 'inbound'` — a full mailbox sync is all ingest.
- `message.thread_id = null` — thread reconciliation is a later ticket.
- `message_participant.contact_id = null` — contact reconciliation is a later ticket.
- `message.sent_at` ← `normalized.sentAt` (the adapter supplies it).

## Implementation notes

- **Migration:** `packages/backend/libs/db/src/migrations/1782115347925_rep-56-sync-schema.ts`
  (3 tables + RLS, the `message_raw_sync_task_id_fkey`, drop `provider_account.sync_cursor`,
  indexes). Views are NOT in the migration — they are app-side Kysely (D2); promote to
  DB views later only if raw-SQL access is needed.
- **`persistMessage`** runs sequential statements inside one transaction (not a single
  writeable CTE) for readability; Rule 3 is satisfied by the single tx the service
  opens. A single-round-trip CTE refinement is a deliberate follow-up.
- **No real-DB integration test harness exists** in the repo (all feature tests are
  compile-only or stubbed `Tx`). The idempotency behavior (D6) is verified by the live
  CLI run; a feature-level integration test is a follow-up once a harness exists.

## Verification (live, against a connected Gmail account)

`sync run personal --full --limit 5` → `started → auth → 5 message → completed`,
status `completed`, cursor captured. DB after: `message_raw`=5, `message`=5,
`message_participant`=10, all `message` events reference a `raw_message_id`,
`message.user_id` populated, `direction='inbound'`. Rerun → graph counts unchanged,
`message` events grew 5→10 (idempotent). An earlier run with an expired token failed
at `auth` and isolated correctly on the task result (motivating D11).

## Complies with

ADR-002 (org RLS), ADR-009 (vertical feature layout), ADR-010 (`runInOrgTx`),
ADR-011 (camelCase/snake_case), ADR-013 (user_id denormalized). Manifesto Rule 5
(feature internal structure), Rule 6 (adapter↔feature boundary; persistence behind
the feature service), Rule 9 (tag boundaries + dependency declaration).
