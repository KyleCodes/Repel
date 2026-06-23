import type { InferResult } from 'kysely';
import type { Json } from '@repel/backend-db/generated';
import type { Tx } from '@repel/backend-db/types';
import type { StoredPayload } from '../../types';

export type EnqueueJobInput = {
  topic: string;
  dedupKey: string | null;
  maxAttempts: number;
  stored: StoredPayload;
};

// Insert a pending job. ON CONFLICT DO NOTHING arbitrates against the partial
// unique index on (topic, dedup_key) WHERE status IN ('pending','processing')
// AND dedup_key IS NOT NULL — so a duplicate enqueue while one is in flight is a
// no-op that returns no row. The conflict target restates the index predicate.
export const buildEnqueueJob = (trx: Tx, input: EnqueueJobInput) =>
  trx
    .insertInto('jobQueue')
    .values({
      topic: input.topic,
      dedupKey: input.dedupKey,
      maxAttempts: input.maxAttempts,
      payload: input.stored as unknown as Json,
    })
    .onConflict((oc) =>
      oc
        .columns(['topic', 'dedupKey'])
        .where('status', 'in', ['pending', 'processing'])
        .where('dedupKey', 'is not', null)
        .doNothing()
    )
    .returning('id');

export type EnqueueJobResult = InferResult<
  ReturnType<typeof buildEnqueueJob>
>[number];

// undefined on the dedup path (ON CONFLICT DO NOTHING returned no row).
export async function enqueueJob(
  trx: Tx,
  input: EnqueueJobInput
): Promise<EnqueueJobResult | undefined> {
  return buildEnqueueJob(trx, input).executeTakeFirst();
}
