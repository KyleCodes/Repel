import type { InferResult } from 'kysely';
import type { Tx } from '@repel/backend-db/types';

// The bare per-job row. No input — the caller's tenant scope (via runInOrgTx)
// determines which org's jobs to list; RLS filters by current_org_id, so the
// select carries no explicit org_id predicate. The derived status/processed/
// taskCount are folded per job by the service (see listSyncJobs).
export const buildListSyncJobs = (trx: Tx) =>
  trx
    .selectFrom('syncJob as j')
    .select(['j.id as jobId', 'j.userId as userId', 'j.createdAt as createdAt'])
    .orderBy('j.createdAt', 'desc');

export type SyncJobBaseRow = InferResult<
  ReturnType<typeof buildListSyncJobs>
>[number];

export async function listSyncJobs(trx: Tx): Promise<SyncJobBaseRow[]> {
  return buildListSyncJobs(trx).execute();
}
