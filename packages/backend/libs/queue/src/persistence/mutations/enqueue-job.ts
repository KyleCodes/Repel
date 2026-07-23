import { type Sql, sql } from '@repel/backend-db/sql';
import type { Tx } from '@repel/backend-db/types';
import type { StoredPayload } from '../../types';

export type EnqueueJobInput = {
  topic: string;
  dedupKey: string | null;
  maxAttempts: number;
  stored: StoredPayload;
};

// Insert a pending job. ON CONFLICT DO NOTHING arbitrates against the partial
// unique index on (topic, dedup_key) WHERE status IN ('pending','processing')
// AND dedup_key IS NOT NULL — so a duplicate enqueue while one is in flight is a
// no-op that returns no row. The conflict target restates the index predicate.
// Raw SQL: the query API cannot target a partial-index conflict arbiter.
export const buildEnqueueJob = (input: EnqueueJobInput): Sql => sql`
  INSERT INTO job_queue (topic, dedup_key, max_attempts, payload)
  VALUES (${input.topic}, ${input.dedupKey}, ${input.maxAttempts},
          ${JSON.stringify(input.stored)}::jsonb)
  ON CONFLICT (topic, dedup_key)
    WHERE status IN ('pending', 'processing') AND dedup_key IS NOT NULL
    DO NOTHING
  RETURNING id`;

export type EnqueueJobResult = { id: string };

// undefined on the dedup path (ON CONFLICT DO NOTHING returned no row).
export async function enqueueJob(
  trx: Tx,
  input: EnqueueJobInput
): Promise<EnqueueJobResult | undefined> {
  const rows = await trx.$queryRaw<EnqueueJobResult[]>(buildEnqueueJob(input));
  return rows[0];
}
