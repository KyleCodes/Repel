import type { Tx } from '@repel/backend-db/types';

// The unit of async work moved through the queue. `topic` selects the logical
// queue (and the consumer bound to it); `orgId` scopes the handler's tenant
// transaction; `payload` is opaque to the queue and typed at the handler
// boundary; `idempotencyKey` deduplicates an in-flight enqueue.
export interface Envelope<T = unknown> {
  topic: string;
  orgId: string;
  payload: T;
  idempotencyKey?: string;
}

// What lands in the job_queue.payload JSONB column. orgId rides as a top-level
// wrapper key — not merged into the user payload — so the user payload shape is
// untouched and orgId extraction on the read side is unambiguous. topic and
// idempotencyKey live in their own columns (topic, dedup_key), not here.
export interface StoredPayload {
  orgId: string;
  payload: unknown;
}

export interface EnqueueOptions {
  orgId: string;
  dedupKey?: string;
  maxAttempts?: number;
  // Join a caller's ambient transaction so the enqueue commits atomically with
  // the triggering write. Omitted, enqueue opens its own short transaction.
  tx?: Tx;
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
  // Max envelopes claimed (and processed concurrently) per poll. v0 default 1;
  // raising it is the batch seam.
  concurrency?: number;
  // How often the consumer sweeps old completed jobs from the table. Default 1h.
  reapIntervalMs?: number;
  // Age after which a completed job is deleted by the sweep. Default 7 days.
  completedTtlMs?: number;
}

// The control surface consume() returns. start() resolves once the poll loop is
// installed; stop() halts claiming, drains in-flight work, and resolves.
export interface ConsumerHandle {
  start(): Promise<void>;
  stop(): Promise<void>;
}
