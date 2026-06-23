# DR-REP-58-1: `libs/queue` — Postgres queue client + consumer runtime

**Ticket:** REP-58 ([Sync] `libs/queue` — Postgres queue client + consumer runtime) — under REP-23 (Syncer).
**Date:** 2026-06-23
**Status:** Accepted
**Depends on:** REP-9 (the `job_queue` table), REP-60 phase 4 (the `libs/queue` slot), REP-64 (`RunnableApp`, the launcher).
**Blocks:** REP-57 (the sync-worker app: `consume('sync', handler)` driving `runSyncJob`).

## Context

Nothing dequeues work today: `libs/transport` was a stub (repurposed into `libs/runtime` by REP-64) and `apps/worker` was deleted. This DR records the queue lib that short-lived enqueuers and long-running consumers share. ADR-004 had already chosen a Postgres-backed queue; the open questions were the _implementation_ behind the `enqueue`/`consume` seam, the schema reshape, the dead-letter model, and how drain reaches the launcher.

## Decisions

### D1 — Hand-rolled transport, not pg-boss

The transport is hand-written over the existing `job_queue` table. pg-boss was evaluated and rejected: it owns its own `pgboss.*` schema and migration lifecycle — parallel to this repo's `repel db migrations`, codegen, and RLS model — and would orphan the REP-9 `job_queue` table. Its one real advantage (high-volume maintenance/archival) is exactly what ADR-004 defers at personal-email volume. The mature single-table Postgres queues (graphile-worker, River, Oban) converge on the design we built; the `Transport` interface (D6) keeps pg-boss adoptable later as a transport swap with no handler rewrite.

### D2 — Reshape the existing `job_queue` table, don't create one

`job_queue` already existed (REP-9) with ADR-004's columns, but its topic column was named `queue` and `status` was `text` + CHECK. The migration (`1782192139396_rep-58-queue-schema.ts`):

- renames `queue` → `topic` (aligns with the `enqueue`/`consume` vocabulary; ADR-004 / manifesto §7 say `topic`),
- rebuilds the `idx_job_queue_poll` / `idx_job_queue_dedup` partial indexes against `topic` (no rename-index op exists in node-pg-migrate),
- converts `status` text+CHECK → a real `job_status` pg enum from the new `@repel/enums` `JobStatus` const (reaches `generated.ts` as a union, matching REP-56's `sync_event_type` pattern).

**Migration ordering (load-bearing, found by applying it live):** the column default and both status-predicate indexes must be dropped _before_ the enum type change — Postgres will not auto-cast a `text` default to the new type, and a `status`-referencing index blocks the `ALTER COLUMN ... TYPE`. So `up()` drops the indexes + CHECK + default, changes the type, then re-sets the default and rebuilds the indexes (whose predicates now compare enum-to-enum). `down()` mirrors it. Verified by a live `up → down → up` round-trip.

### D3 — Table stays non-org-scoped; tenancy rides in the envelope

No `org_id` column was added; RLS stays permissive (`USING(true)`, as REP-9 deliberately chose — "tenancy in payload"). Queue operations therefore use `runInTx` (unscoped), not `runInOrgTx`. The `Envelope` carries `orgId`, stored in the `job_queue.payload` JSONB as a top-level wrapper `{ orgId, payload }` (not merged into the user payload — avoids key collision, unambiguous read-side extraction). A consumer's handler is responsible for opening its own org-scoped transaction for domain work; the queue itself never scopes a tenant.

### D4 — Dead-letter is an in-place `dead` status, not a separate `-dlq` topic

On retry exhaustion (or a `PermanentHandlerError`) the row transitions to `status='dead'` and stays on its topic. The "dead-letter queue" is a query over `status='dead'` rows. This matches graphile-worker / River / Oban (all use an in-table terminal status; none move or copy the row, and none mutate the topic column — researched). The pg-boss-style redrive (INSERT a new row on `${topic}-dlq`, mark the original `dead`) and a replay verb are **deferred** as future seams needing no schema change. In-place-topic-mutation was explicitly rejected (loses audit trail, thrashes the indexed topic column, breaks the `(topic, dedup_key)` dedup identity).

### D5 — Enqueue joins an ambient transaction when given one

`enqueue(topic, payload, { orgId, dedupKey?, maxAttempts?, tx? })` opens its own short `runInTx` by default, but accepts an injected `tx` to commit atomically with the triggering write (ADR-004 MUST: "enqueue in the same transaction as the triggering insert"). Dedup is an `ON CONFLICT DO NOTHING` against the partial unique index `(topic, dedup_key) WHERE status IN ('pending','processing') AND dedup_key IS NOT NULL`; a no-row return is the dedup path. The result is discriminated (`{ enqueued: true, id } | { enqueued: false, reason: 'dedup' }`), never null.

### D6 — The `Transport` interface is the swap seam and the test seam

The lib is one package, `@repel/backend-queue`, with two folders mirroring the domain-lib precedent (`persistence/` + the worker-facing layer):

- `persistence/` — the transport: the only code that touches `job_queue`. Five `buildX`+`InferResult` mutation builders (`enqueue`, `claim`, `complete`, `reschedule`, `dead-letter`) behind a `Transport` interface; `pgTransport` implements it (each op a `runInTx`).
- `client/` — `enqueue()` + `consume()`. **The poll loop lives inside `consume()`**, not a separate `runtime/` dir — it's just what the consumer client does.

The runtime depends only on the `Transport` interface, so it is unit-tested against a `FakeTransport` with zero Postgres, and a future non-Postgres backend swaps the impl without touching the runtime or any handler. (The two-package split — `queue-transport` + `queue-client` — was a ticket non-goal; one lib with an in-package interface is the start.)

### D7 — Consumer runtime: recursive `setTimeout`, single-item v0, drain on stop

`consume(topic, handler, config?)` returns a `ConsumerHandle`. `start()` is resolve-when-ready (installs the poll loop, returns — mirrors `RunnableApp.start()` / the api's `startApi`). The loop is a self-pacing recursive `setTimeout` (not `setInterval` — a slow poll can't overlap itself). Each tick claims up to `concurrency` due jobs (default 1) via `FOR UPDATE SKIP LOCKED`, runs the handler on each via `Promise.allSettled`, and reschedules. `stop()` halts claiming, clears the timer, and awaits the tracked in-flight set — draining before it resolves. Single-item delivery is v0; `claim(limit)` + `allSettled` is the batch seam (raise `concurrency`). Defaults are module constants — **no `config.ts`** this ticket. Backoff is exponential full-jitter capped (base 1s, ×2, cap 5min) in `client/backoff.ts`.

Retry-vs-dead-letter: a claimed row's `attempts` already counts the current delivery (incremented at claim), so a handler throw reschedules while `attempts < maxAttempts` and dead-letters once exhausted; `PermanentHandlerError` dead-letters immediately.

### D8 — Launcher drain wiring (a cli change, outside the lib)

REP-64's launcher closed the pool on SIGINT/SIGTERM but never called `app.stop()`, so consumer drain would never run. `cli/services/handler.ts` now collects booted `RunnableApp`s and a new `drainAndClose(apps, closeDb)` helper awaits `app.stop?.()` on each _before_ `closeDb()`. `stop?()` is optional (ADR-015) — a no-op for the api today, forward-looking for REP-57's sync-worker, which is the first app to implement it.

## Implementation notes

- `claim-jobs.ts`: `.where('scheduledFor', '<=', sql<Date>\`now()\`)`— the raw needs an explicit type arg or`tsc --build`rejects the operand (Bun runs it untyped, so only the build caught it).`FOR UPDATE SKIP LOCKED`attaches to the inner select via`.modifyEnd(sql\`for update skip locked\`)`; the compiled SQL places it inside the subselect (verified by the compile-only test).
- The dedup `ON CONFLICT` uses `.columns(['topic','dedupKey']).where(...).doNothing()`; kysely 0.27.3 emits the predicate in the `ON CONFLICT (...) WHERE ...` position (verified by the compile-only test) — both plan OPENs resolved.
- `@repel/enums` is **not** a dep of `libs/queue`: the `JobStatus` values reach the code only through `generated.ts` (via `@repel/backend-db`), so `@nx/dependency-checks` (manifesto Rule 8) correctly required dropping the declared-but-unused dep.

## Verification

- Full workspace `nx run-many -t build lint test` green (15 projects); `nx sync:check` clean.
- 13 queue-lib tests: 5 compile-only SQL-shape (claim `FOR UPDATE SKIP LOCKED` in-subselect, enqueue `ON CONFLICT DO NOTHING`, dead-letter `status='dead'`, reschedule backoff interval); 3 backoff bounds; 5 consumer (FIFO claim, concurrency, retry-then-dead-letter, `PermanentHandlerError` fast-path, `stop()` drains a gated in-flight handler). 2 new cli `drainAndClose` tests (stop-before-close ordering; no-op without `stop()`).
- Migration applied live and round-tripped (`up → down → up`); `generated.ts` regenerated with `topic` + `status: Generated<JobStatus>`.

## Deferred (future seams, not tickets yet)

- **AC6 real-DB integration test** (enqueue N vs a 50%-failing handler): no integration harness exists in the repo (all tests are compile-only / fake-injected, as in REP-56). The `FakeTransport` unit layer covers the retry/dead-letter/drain logic; a real-DB harness is a follow-up.
- **`-dlq` redrive topic + replay verb** (D4): add when a live dead-letter consumer is actually needed.
- **Batch delivery** (D7): raise `concurrency`; the claim/`allSettled` path already supports it.

## Complies with

ADR-004 (Postgres `job_queue`, one table + `topic` column, `FOR UPDATE SKIP LOCKED`, `enqueue`/`consume` as the swap seam, enqueue-in-triggering-tx), ADR-002 (org RLS — unchanged; queue is non-org-scoped by REP-9's design), ADR-010 (`runInTx`), ADR-015 (`stop?()` reserved), ADR-016 (consumer hosted by an app launched by `cli services run`). Manifesto §7 (the queue owns no business logic), Rule 8 (tag boundaries + dependency declaration).
