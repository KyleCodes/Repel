import type { Tx } from '@repel/backend-db/types';
import type { LogContext } from '@repel/logger/context';

// The unit of async work moved through the queue. `topic` selects the logical
// queue (and the consumer bound to it); `orgId` scopes the handler's tenant
// transaction; `payload` is opaque to the queue and typed at the handler
// boundary; `idempotencyKey` deduplicates an in-flight enqueue.
export interface Envelope<T = unknown> {
  topic: string;
  orgId: string;
  payload: T;
  idempotencyKey?: string;
  // Correlation id of the trace that enqueued this job; the consumer adopts it
  // so one trace spans enqueue→consume.
  traceId?: string;
}

// What lands in the job_queue.payload JSONB column. orgId rides as a top-level
// wrapper key — not merged into the user payload — so the user payload shape is
// untouched and orgId extraction on the read side is unambiguous. topic and
// idempotencyKey live in their own columns (topic, dedup_key), not here.
// traceId rides the wrapper too — correlation metadata, never merged into the
// user payload.
export interface StoredPayload {
  orgId: string;
  payload: unknown;
  traceId?: string;
}

export interface EnqueueOptions {
  orgId: string;
  dedupKey?: string;
  maxAttempts?: number;
  // Join a caller's ambient transaction so the enqueue commits atomically with
  // the triggering write. Omitted, enqueue opens its own short transaction.
  tx?: Tx;
  // Explicit trace to stamp on the job. Normally omitted — enqueue inherits the
  // ambient log context's traceId so the trace propagates with no call-site work.
  traceId?: string;
}

// Discriminated so a deduplicated enqueue is an explicit outcome, never a
// silently dropped signal.
export type EnqueueResult =
  | { enqueued: true; id: string }
  | { enqueued: false; reason: 'dedup' };

// What a consumer runs per delivered envelope. Throwing retries (until
// max_attempts, then dead-letter); throwing PermanentHandlerError dead-letters
// immediately.
export type QueueHandler = (envelope: Envelope) => Promise<void>;

export interface ConsumerConfig {
  // Identifies the claiming process in locked_by. Defaults to a per-run id.
  consumerId?: string;
  pollIntervalMs?: number;
  // Max handler invocations in flight at once (the pool size). Default 1.
  concurrency?: number;
  // Rows claimed per DB round-trip, decoupled from concurrency: a poll claims a
  // batch this size and feeds the pool, which refills as slots free. Default =
  // concurrency.
  batchSize?: number;
  // How often the consumer sweeps old completed jobs from the table. Default 1h.
  reapIntervalMs?: number;
  // Age after which a completed job is deleted by the sweep. Default 7 days.
  completedTtlMs?: number;
  // Diagnostic fields seeded into the per-job context (e.g. the owning
  // service). Merged under traceId/jobId, which the consumer always sets.
  contextFields?: Partial<LogContext>;
}

// The control surface consume() returns. start() resolves once the poll loop is
// installed; stop() halts claiming, drains in-flight work, and resolves.
export interface ConsumerHandle {
  start(): Promise<void>;
  stop(): Promise<void>;
}
