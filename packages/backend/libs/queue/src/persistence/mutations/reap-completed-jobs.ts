import { type Sql, sql } from '@repel/backend-db/sql';
import type { Tx } from '@repel/backend-db/types';

export type ReapCompletedJobsInput = { ttlMs: number };

// Delete completed jobs older than the TTL so the table does not grow without
// bound. Only `completed` rows are reaped — `dead` rows are left for failure
// inspection. The partial poll index never touches these rows (it is WHERE
// status = 'pending'), so this is pure space reclamation, not a hot path.
export const buildReapCompletedJobs = (
  input: ReapCompletedJobsInput
): Sql => sql`
  DELETE FROM job_queue
  WHERE status = 'completed'
    AND completed_at < now() - (${input.ttlMs}::int * interval '1 millisecond')`;

// Returns the number of rows deleted.
export async function reapCompletedJobs(
  trx: Tx,
  input: ReapCompletedJobsInput
): Promise<number> {
  return trx.$executeRaw(buildReapCompletedJobs(input));
}
