import { sql } from 'kysely';
import type { Tx } from '@repel/backend-db/types';

export type ReapCompletedJobsInput = { ttlMs: number };

// Delete completed jobs older than the TTL so the table does not grow without
// bound. Only `completed` rows are reaped — `dead` rows are left for failure
// inspection. The partial poll index never touches these rows (it is WHERE
// status = 'pending'), so this is pure space reclamation, not a hot path.
export const buildReapCompletedJobs = (
  trx: Tx,
  input: ReapCompletedJobsInput
) =>
  trx
    .deleteFrom('jobQueue')
    .where('status', '=', 'completed')
    .where(
      'completedAt',
      '<',
      sql<Date>`now() - (${input.ttlMs}::int * interval '1 millisecond')`
    );

// Returns the number of rows deleted.
export async function reapCompletedJobs(
  trx: Tx,
  input: ReapCompletedJobsInput
): Promise<number> {
  const result = await buildReapCompletedJobs(trx, input).executeTakeFirst();
  return Number(result.numDeletedRows);
}
