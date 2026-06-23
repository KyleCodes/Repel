import { runInTx } from '@repel/backend-db/tx';
import {
  type EnqueueJobInput,
  enqueueJob,
} from '../persistence/mutations/enqueue-job';
import type { EnqueueOptions, EnqueueResult } from '../types';

const DEFAULT_MAX_ATTEMPTS = 3;

// Write an envelope to a topic. By default this opens its own short transaction;
// pass `opts.tx` to enqueue inside a caller's ambient transaction so the job
// commits atomically with the write that triggered it. A duplicate enqueue while
// a `(topic, dedupKey)` job is still pending/processing is a no-op that returns
// { enqueued: false, reason: 'dedup' } — never a dropped signal, never null.
export async function enqueue<T>(
  topic: string,
  payload: T,
  opts: EnqueueOptions
): Promise<EnqueueResult> {
  const input: EnqueueJobInput = {
    topic,
    dedupKey: opts.dedupKey ?? null,
    maxAttempts: opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    stored: { orgId: opts.orgId, payload },
  };

  const row = opts.tx
    ? await enqueueJob(opts.tx, input)
    : await runInTx((trx) => enqueueJob(trx, input))({});

  return row
    ? { enqueued: true, id: row.id }
    : { enqueued: false, reason: 'dedup' };
}
