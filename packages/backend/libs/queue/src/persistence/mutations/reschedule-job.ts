import { sql } from 'kysely';
import type { Tx } from '@repel/backend-db/types';

export type RescheduleJobInput = {
  id: string;
  backoffMs: number;
  lastError: string;
};

// Return a transiently-failed job to the queue, due after a backoff delay, and
// release its lock so the next poll can re-claim it.
export const buildRescheduleJob = (trx: Tx, input: RescheduleJobInput) =>
  trx
    .updateTable('jobQueue')
    .set({
      status: 'pending',
      lastError: input.lastError,
      scheduledFor: sql`now() + (${input.backoffMs}::int * interval '1 millisecond')`,
      lockedAt: null,
      lockedBy: null,
    })
    .where('id', '=', input.id);

export async function rescheduleJob(
  trx: Tx,
  input: RescheduleJobInput
): Promise<void> {
  await buildRescheduleJob(trx, input).execute();
}
