import type { SyncJob } from '@repel/backend-db/prisma/client';
import type { Tx } from '@repel/backend-db/types';

// The bare per-job row. No input — the caller's tenant scope (via runInOrgTx)
// determines which org's jobs to list; RLS filters by current_org_id, so the
// query carries no explicit org_id predicate. The derived status/processed/
// taskCount are folded per job by the service (see listSyncJobs).

export type SyncJobBaseRow = {
  jobId: SyncJob['id'];
  userId: SyncJob['userId'];
  createdAt: SyncJob['createdAt'];
};

export async function listSyncJobs(trx: Tx): Promise<SyncJobBaseRow[]> {
  const rows = await trx.syncJob.findMany({
    select: { id: true, userId: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((r) => ({
    jobId: r.id,
    userId: r.userId,
    createdAt: r.createdAt,
  }));
}
