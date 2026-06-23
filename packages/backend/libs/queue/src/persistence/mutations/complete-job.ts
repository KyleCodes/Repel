import { sql } from 'kysely';
import type { Tx } from '@repel/backend-db/types';

export type CompleteJobInput = { id: string };

// Mark a claimed job done and release its lock.
export const buildCompleteJob = (trx: Tx, input: CompleteJobInput) =>
  trx
    .updateTable('jobQueue')
    .set({
      status: 'completed',
      completedAt: sql`now()`,
      lockedAt: null,
      lockedBy: null,
    })
    .where('id', '=', input.id);

export async function completeJob(
  trx: Tx,
  input: CompleteJobInput
): Promise<void> {
  await buildCompleteJob(trx, input).execute();
}
