import { type InferResult, sql } from 'kysely';
import type { Tx } from '@repel/backend-db/types';

export type ClaimJobsInput = {
  topic: string;
  consumerId: string;
  limit: number;
};

// Atomically claim up to `limit` due jobs for a topic. The inner SELECT picks
// the oldest pending, due rows with FOR UPDATE SKIP LOCKED so concurrent
// consumers never claim the same row; the UPDATE flips them to processing and
// increments attempts. attempts is incremented here (at claim), so a claimed
// row's attempts already counts this delivery.
export const buildClaimJobs = (trx: Tx, input: ClaimJobsInput) =>
  trx
    .updateTable('jobQueue')
    .set({
      status: 'processing',
      lockedAt: sql`now()`,
      lockedBy: input.consumerId,
      attempts: sql`attempts + 1`,
    })
    .where('id', 'in', (eb) =>
      eb
        .selectFrom('jobQueue')
        .select('id')
        .where('topic', '=', input.topic)
        .where('status', '=', 'pending')
        .where('scheduledFor', '<=', sql<Date>`now()`)
        .orderBy('scheduledFor')
        .limit(input.limit)
        .modifyEnd(sql`for update skip locked`)
    )
    .returningAll();

export type ClaimJobsRow = InferResult<
  ReturnType<typeof buildClaimJobs>
>[number];

export async function claimJobs(
  trx: Tx,
  input: ClaimJobsInput
): Promise<ClaimJobsRow[]> {
  return buildClaimJobs(trx, input).execute();
}
