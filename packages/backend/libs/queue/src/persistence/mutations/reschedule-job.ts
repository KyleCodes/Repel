import { type Sql, sql } from '@repel/backend-db/sql';
import type { Tx } from '@repel/backend-db/types';

export type RescheduleJobInput = {
  id: string;
  backoffMs: number;
  lastError: string;
};

// Return a transiently-failed job to the queue, due after a backoff delay, and
// release its lock so the next poll can re-claim it.
export const buildRescheduleJob = (input: RescheduleJobInput): Sql => sql`
  UPDATE job_queue SET
    status = 'pending',
    last_error = ${input.lastError},
    scheduled_for = now() + (${input.backoffMs}::int * interval '1 millisecond'),
    locked_at = NULL,
    locked_by = NULL
  WHERE id = ${input.id}`;

export async function rescheduleJob(
  trx: Tx,
  input: RescheduleJobInput
): Promise<void> {
  await trx.$executeRaw(buildRescheduleJob(input));
}
