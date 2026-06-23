import { sql } from 'kysely';
import type { Tx } from '@repel/backend-db/types';

export type DeadLetterJobInput = {
  id: string;
  lastError: string;
};

// Terminally fail a job that exhausted its attempts (or threw a permanent
// error). The row stays on its topic in `dead` status — the dead-letter "queue"
// is a query over these rows. Releasing the lock keeps the row inert.
export const buildDeadLetterJob = (trx: Tx, input: DeadLetterJobInput) =>
  trx
    .updateTable('jobQueue')
    .set({
      status: 'dead',
      lastError: input.lastError,
      completedAt: sql`now()`,
      lockedAt: null,
      lockedBy: null,
    })
    .where('id', '=', input.id);

export async function deadLetterJob(
  trx: Tx,
  input: DeadLetterJobInput
): Promise<void> {
  await buildDeadLetterJob(trx, input).execute();
}
