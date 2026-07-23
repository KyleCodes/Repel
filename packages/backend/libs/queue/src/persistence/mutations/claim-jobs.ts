import type { JobQueue } from '@repel/backend-db/prisma/client';
import { type Sql, sql } from '@repel/backend-db/sql';
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
// row's attempts already counts this delivery. Raw SQL: SKIP LOCKED has no
// query-API expression; camelCase is aliased in the RETURNING list.
export const buildClaimJobs = (input: ClaimJobsInput): Sql => sql`
  UPDATE job_queue SET
    status = 'processing',
    locked_at = now(),
    locked_by = ${input.consumerId},
    attempts = attempts + 1
  WHERE id IN (
    SELECT id FROM job_queue
    WHERE topic = ${input.topic} AND status = 'pending' AND scheduled_for <= now()
    ORDER BY scheduled_for
    LIMIT ${input.limit}
    FOR UPDATE SKIP LOCKED
  )
  RETURNING
    id, topic, payload, status, attempts,
    dedup_key     AS "dedupKey",
    max_attempts  AS "maxAttempts",
    last_error    AS "lastError",
    locked_at     AS "lockedAt",
    locked_by     AS "lockedBy",
    scheduled_for AS "scheduledFor",
    completed_at  AS "completedAt",
    created_at    AS "createdAt"`;

export type ClaimJobsRow = JobQueue;

export async function claimJobs(
  trx: Tx,
  input: ClaimJobsInput
): Promise<ClaimJobsRow[]> {
  return trx.$queryRaw<ClaimJobsRow[]>(buildClaimJobs(input));
}
