import { type Sql, sql } from '@repel/backend-db/sql';
import type { Tx } from '@repel/backend-db/types';

export type CompleteJobInput = { id: string };

// Mark a claimed job done and release its lock. Raw SQL for the server-side
// now() — the query API cannot set a column to a SQL expression.
export const buildCompleteJob = (input: CompleteJobInput): Sql => sql`
  UPDATE job_queue SET
    status = 'completed',
    completed_at = now(),
    locked_at = NULL,
    locked_by = NULL
  WHERE id = ${input.id}`;

export async function completeJob(
  trx: Tx,
  input: CompleteJobInput
): Promise<void> {
  await trx.$executeRaw(buildCompleteJob(input));
}
