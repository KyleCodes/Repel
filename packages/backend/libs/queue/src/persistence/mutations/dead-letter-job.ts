import { type Sql, sql } from '@repel/backend-db/sql';
import type { Tx } from '@repel/backend-db/types';

export type DeadLetterJobInput = {
  id: string;
  lastError: string;
};

// Terminally fail a job that exhausted its attempts (or threw a permanent
// error). The row stays on its topic in `dead` status — the dead-letter "queue"
// is a query over these rows. Releasing the lock keeps the row inert.
export const buildDeadLetterJob = (input: DeadLetterJobInput): Sql => sql`
  UPDATE job_queue SET
    status = 'dead',
    last_error = ${input.lastError},
    completed_at = now(),
    locked_at = NULL,
    locked_by = NULL
  WHERE id = ${input.id}`;

export async function deadLetterJob(
  trx: Tx,
  input: DeadLetterJobInput
): Promise<void> {
  await trx.$executeRaw(buildDeadLetterJob(input));
}
