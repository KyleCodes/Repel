import { runInTx } from '@repel/backend-db/tx';
import type { Envelope, StoredPayload } from '../types';
import { type ClaimJobsRow, claimJobs } from './mutations/claim-jobs';
import { completeJob } from './mutations/complete-job';
import { deadLetterJob } from './mutations/dead-letter-job';
import { type EnqueueJobInput, enqueueJob } from './mutations/enqueue-job';
import { reapCompletedJobs } from './mutations/reap-completed-jobs';
import { rescheduleJob } from './mutations/reschedule-job';

// The queue's persistence service. `Transport` is the swap seam (the manifesto's
// term, ADR-004 §7): the one interface that knows the queue is Postgres, so the
// runtime and every handler stay storage-agnostic and a future backend swap is
// contained here. The file follows the persistence/service.ts convention; the
// symbol keeps the architectural vocabulary.

// A claimed job as the consumer runtime sees it: the reconstructed envelope plus
// the lifecycle counters that decide retry vs. dead-letter.
export interface ClaimedJob {
  id: string;
  envelope: Envelope;
  attempts: number;
  maxAttempts: number;
}

// The seam between the consumer runtime and storage. The runtime depends only
// on this interface, so it is unit-testable against a fake and the Postgres
// implementation is swappable for another backend without touching the runtime
// or any handler.
export interface Transport {
  enqueue(input: EnqueueJobInput): Promise<{ id: string } | undefined>;
  claim(
    topic: string,
    consumerId: string,
    limit: number
  ): Promise<ClaimedJob[]>;
  complete(id: string): Promise<void>;
  reschedule(id: string, backoffMs: number, lastError: string): Promise<void>;
  deadLetter(id: string, lastError: string): Promise<void>;
  // Delete completed jobs older than ttlMs; returns the number reaped.
  reap(ttlMs: number): Promise<number>;
}

// Reconstruct the envelope from a claimed row: orgId comes out of the stored
// payload wrapper, dedup_key maps back to idempotencyKey.
function fromRow(row: ClaimJobsRow): ClaimedJob {
  const stored = row.payload as unknown as StoredPayload;
  return {
    id: row.id,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    envelope: {
      topic: row.topic,
      orgId: stored.orgId,
      payload: stored.payload,
      ...(row.dedupKey !== null && { idempotencyKey: row.dedupKey }),
    },
  };
}

// The Postgres transport. Each operation runs in its own short, unscoped
// transaction — job_queue is not org-scoped (tenancy rides inside the envelope),
// so runInTx, not runInOrgTx.
export const pgTransport: Transport = {
  enqueue(input) {
    return runInTx((trx) => enqueueJob(trx, input))({});
  },
  async claim(topic, consumerId, limit) {
    const rows = await runInTx((trx) =>
      claimJobs(trx, { topic, consumerId, limit })
    )({});
    return rows.map(fromRow);
  },
  complete(id) {
    return runInTx((trx) => completeJob(trx, { id }))({});
  },
  reschedule(id, backoffMs, lastError) {
    return runInTx((trx) => rescheduleJob(trx, { id, backoffMs, lastError }))(
      {}
    );
  },
  deadLetter(id, lastError) {
    return runInTx((trx) => deadLetterJob(trx, { id, lastError }))({});
  },
  reap(ttlMs) {
    return runInTx((trx) => reapCompletedJobs(trx, { ttlMs }))({});
  },
};
