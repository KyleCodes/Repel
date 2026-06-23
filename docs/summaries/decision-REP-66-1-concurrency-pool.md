# DR-REP-66-1: `@repel/concurrency` — bounded-concurrency work pool primitive

**Ticket:** REP-66 ([Async] Bounded-concurrency work pool primitive — steady-state saturation) — Foundations.
**Date:** 2026-06-23
**Status:** Accepted
**Depends on:** REP-58 (the `consume()` runtime this becomes the concurrency core of), REP-55/REP-57 (the `runSyncJob` fan-out it generalizes).
**Relates to:** REP-54 (Gmail ingest concurrent fetch — folded into this ticket, round 2).

> **Round 2 (2026-06-23):** added the `Channel` primitive + `boundedConcurrencyPoolStream` streaming construct, applied them to Gmail `ingest()` (folding in REP-54) and the queue `consume()` loop. See D9–D12 below; D8's deferral is superseded.

## Context

Three sites did naive batch-and-wait fan-out: `libs/queue` `consume()` (claim `concurrency`, `allSettled`, repoll), `libs/sync` `runSyncJob()` (`allSettled` over tasks), and Gmail `ingest()` (one `messages.get` at a time — REP-54). Throughput was bound by the slowest item per batch, and `consume()`'s single `concurrency` knob conflated "rows claimed per round-trip" with "max handlers in flight." REP-66 builds one reusable steady-state-saturation primitive and rewires the two simple sites onto it. Gmail `ingest()` is deferred to REP-54 (it needs order/cap/cursor design).

## Decisions

### D1 — Composed factory, not a process singleton or AsyncLocalStorage

`createConcurrencyPool({ size })` is a plain factory returning a closure-over-state struct; callers construct one per workload (one per consumer; later one per in-task fetch). Rejected: a process singleton (à la `libs/db/runtime.ts`) — a DB connection pool is a scarce OS resource that warrants exactly one, but a promise concurrency limiter is a policy, and policies compose. A global pool head-of-line-couples unrelated workloads (a slow job starves another topic). Also rejected: AsyncLocalStorage-scoped pools — implicit, no codebase precedent, and it muddies the `size:1` debug path. A future process-wide ceiling, if ever needed, is a separately-composed shared semaphore the per-workload pools acquire from, not a singleton everyone dumps into.

### D2 — A new `scope:shared`, zero-dependency lib

`@repel/concurrency` at `packages/shared/concurrency`. Shared (not `packages/backend/libs`) so the frontend could reuse it; `scope:shared` is importable by both backend and frontend, and shared imports only shared (`eslint.config.mjs`). The primitive is pure async/TS with no dependencies, so the boundary holds. Named `@repel/concurrency` (bare scope, the shared-package convention — cf. `@repel/slug`, `@repel/http`).

### D3 — Closure struct, not a class

The pool is a `consume()`-style closure over its mutable state (`active`, `queue`, idle/capacity waiters), matching the house "typed struct adhering to an interface" idiom. No non-error classes in the backend.

### D4 — Minimal surface: `submit` / `whenCapacityAvailable` / `onIdle` + `runPool`

The pool exposes `submit(thunk)` (resolves/rejects with the thunk's own outcome; always frees + refills the slot), `whenCapacityAvailable()` (producer backpressure), `onIdle()` (drain barrier, re-arms), and `activeCount`/`queuedCount` for instrumentation. `runPool(items, size, fn)` is a bounded-concurrency `Promise.allSettled(items.map(fn))` returning results in **input order** — the drop-in for the two `allSettled` sites. A completion-order async-iterator was deliberately **not** built into the pool: only Gmail ingest (REP-54) needs it, and it is a small local bridge on `submit`; baking it in would over-build for one future caller.

### D5 — Saturation via `try/finally` slot release

`run(thunk)` increments `active`, awaits the thunk, and in a `finally` decrements and admits the next queued thunk (or signals idle/capacity). `submit` runs immediately when `active < size`, else parks an admit-resolver on a FIFO queue. Properties: max in-flight never exceeds `size`; refill is single-thunk-on-completion, not batched; `size:1` serializes strictly (the second concurrent submit queues); a throwing thunk's rejection reaches only its caller while the `finally` still frees + refills the slot.

### D6 — `consume()`: decouple pool size from claim batch size

`ConsumerConfig.concurrency` is now the **pool size**; a new `batchSize` (default = `concurrency`) is rows claimed per DB round-trip. `poll()` awaits `whenCapacityAvailable()`, claims `batchSize` rows, `void pool.submit(() => process(job))` per row (not awaited — the pool refills and stays saturated), then schedules the next poll hot (full batch) or after `pollIntervalMs` (short batch — topic drained). `stop()` drains via `pool.onIdle()`, replacing the hand-rolled `inFlight` Set + `track()`. The reaper and `ConsumerHandle` contract are unchanged. `batchSize` defaulting to `concurrency` keeps every existing test green.

### D7 — `runSyncJob`: `allSettled` → `runPool`, add `taskConcurrency`

The task fan-out becomes `runPool(job.tasks, taskConcurrency, (task) => runSyncTask(job, task, deps))`. `runPool` returns input-ordered `PromiseSettledResult[]`, so the existing position-indexed rollup and the `every(completed)` status fold are untouched. Failure isolation holds (`runSyncTask` never throws; a rejection would still become a `rejected` settled entry). `DEFAULT_TASK_CONCURRENCY = 4` (**OPEN** — sized for a handful of accounts per job; revisit if jobs grow large). `size:1` runs tasks sequentially for step-debugging.

### D8 — Gmail `ingest()` (superseded by D11 — now folded into REP-66)

Round 1 deferred the concurrent-message-fetch rewrite to REP-54. Round 2 folded it in: the streaming construct (D10) made the design tractable, so `ingest()` is rewritten here and REP-54 is closed into REP-66.

### D9 — `Channel<T>`: a dumb, unbounded async queue

`createChannel<T>()` is a generic async queue — `push` / `close` / `fail` / `AsyncIterable` — with **zero pool awareness**. It is the reusable producer→consumer streaming primitive that earlier sketches hand-rolled inline (a `ready[]` buffer + `wake` notifier + `producing` flag). Extracting it as its own block makes the streaming construct (D10) pure composition. **The channel is unbounded; `push` never blocks** — the decision is that _the pool bounds, not the channel_ (D10), so backpressure lives in one place. Buffered values drain before a `close`/`fail` takes effect; the first `fail` wins.

### D10 — `boundedConcurrencyPoolStream`: composition of pool + channel

The convenience construct the module exports. It composes a fresh `ConcurrencyPool` + a fresh `Channel` — the two primitives stay mutually unaware; this is the only code that knows both. It pulls the source **lazily**, gated by `pool.whenCapacityAvailable()`, so the source generator is suspended whenever the pool is saturated. That capacity gate is the backpressure: a producer can never run ahead and pile work in memory (this directly answers the "claim loop backs up unbounded" concern). Each settled result is `channel.push`ed; on source exhaustion + pool drain, `channel.close()`; the first rejection `channel.fail`s the stream. Results stream in **completion order** (order doesn't matter — results are DB-written, the querying app orders). It is itself an `async function*` delegating to the channel, so an early consumer `break` triggers `return()` → a `try/finally` flips a `cancelled` flag that stops further source pulls and submissions (MDN-confirmed async-generator cleanup). In-flight pool work still settles — the pool has no cancellation.

Rejected: baking the streaming iterator into the pool core, or a lower-level channel that the caller hand-wires to the pool. The two-block-plus-thin-construct shape keeps each piece independently testable and reusable.

### D11 — Gmail `ingest()` on the construct (folds in REP-54)

`ingest()` exposes message-ids as a lazy paginating generator (`messageIds`) capped at `cap`, then streams `processMessage` through `boundedConcurrencyPoolStream`. The serial `do/while` collapses to a flat `for await`. Cap stays exact (the id source yields ≤ `cap`); the cursor is still captured before listing; `processed` counts yielded events; fail-loud is preserved (a typed `Gmail*Error` fails the stream → `ingest` throws, no `completed`). All existing ingest tests pass unchanged (they assert on the message _set_/count, never a positional id). `FETCH_CONCURRENCY` is **configurable, default 8** — derived from Gmail's 250 quota-units/sec ÷ ~5 units/`messages.get` (~50 gets/s; ~8 in flight at ~150ms latency). The per-method cost reportedly rose toward 20 units in 2026 (→ ~12 gets/s, argues for ~4); re-confirm against Google's live quota page and tune down if so. (Sources: Google Gmail API usage limits; Nylas Gmail quotas 2026.)

### D12 — `consume()` reframed on the construct (pure refactor)

The hand-rolled poll loop (recursive `setTimeout` + an in-flight pool) becomes a lazy `claimedJobs()` source streamed through `boundedConcurrencyPoolStream`. `start()` drives the stream to exhaustion; `stop()` flips `running` (ending the source after its current claim) and `await`s the stream drain — replacing the prior `pool.onIdle()` drain. Re-claim pacing is **unchanged from before**: a full batch loops immediately, a partial/empty batch backs off `pollIntervalMs` (the topic is drained — a slow producer — so spinning would hammer it). A `signalStop` ends a mid-backoff sleep promptly so `stop()` doesn't wait a full interval. The construct's capacity gate additionally bounds the in-memory backlog (the source suspends when the pool is saturated — strictly better than the old claim-a-whole-batch behavior). No behavior change; all existing consume tests pass.

## Implementation notes

- Lib: `packages/shared/concurrency/src/{pool,run-pool,channel,bounded-concurrency-pool-stream,index}.ts`. Registered in the hand-maintained root `tsconfig.json` references; `nx sync` wired the per-package references into queue, sync, and adapters.
- `consume()` is now a `claimedJobs()` source streamed through `boundedConcurrencyPoolStream`; `stop()` flips `running` + ends a mid-backoff sleep via `signalStop`, then awaits the stream drain.
- `ingest()` paginates via a lazy `messageIds` generator and streams `processMessage`; `FETCH_CONCURRENCY` overridable via `deps.fetchConcurrency`.

## Verification

- `@repel/concurrency`: 27 unit tests — pool/run-pool (12: max-in-flight ≤ N, single-thunk refill, `size:1` sequential, throw frees+refills, gating, isolation; `runPool` input-order/at-index/bound/empty), `channel` (7: FIFO, close wakes a parked consumer, buffered drain before close/fail, fail throws, first-fail wins), `boundedConcurrencyPoolStream` (8: completion-order, concurrency bound, lazy pull, first-error fail, empty, bounded-large, source-throws, early-break-stops-producer).
- `consume()` (round 1): 2 tests (batchSize claims 5 / handlers cap at 2; saturation across batches). Round 2 reframe: +1 (stop ends mid-backoff promptly); all 21 green — pure refactor, no behavior change.
- `runSyncJob`: 3 tests (taskConcurrency bound, `size:1` sequential, rollup under pooling) + existing green.
- `ingest()`: +4 tests (concurrency bound on gets, completion-order, cap-exact under concurrency across pages, one failed get fails the sync) + the existing 14 unchanged. 18 total.
- Full `nx run-many -t build lint test` green (17 projects); `nx sync:check` clean.
- Manual (no DB harness — repo norm): `repel sync run <account> --full --limit 50` (concurrent fetch) and `cli services run sync-worker` with `concurrency>1` (multi-job + SIGINT drain) are the live checks units can't cover.

## OPEN

- **`DEFAULT_TASK_CONCURRENCY` (4)** in sync and **`FETCH_CONCURRENCY` (8)** in the Gmail adapter — both depend on the live Gmail per-method quota cost (5 vs 20 units/`messages.get`). Re-confirm against Google's quota page; conservative defaults stand until then.
- **Adaptive throttling** (read a 429 `Retry-After` to self-tune fetch concurrency) — out of scope; the queue's existing backoff covers retries.

## Complies with

ADR-015 (exports map; `consume()`'s `ConsumerHandle` unchanged), manifesto Rule 8 (tag boundaries — `scope:shared` zero-dep; queue/sync/adapters declare the new dep; root tsconfig reference added by hand). No new tag dimension.
