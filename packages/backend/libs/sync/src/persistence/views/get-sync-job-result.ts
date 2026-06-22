import type { Tx } from '@repel/backend-db/types';
import { SyncJobStatus, type SyncJobStatusSlug } from '@repel/enums';
import {
  type SyncTaskResultRow,
  getSyncTaskResults,
} from './get-sync-task-results';

export type GetSyncJobResultInput = {
  syncJob: { id: string };
};

export type SyncJobResultRow = {
  jobId: string;
  status: SyncJobStatusSlug;
  processed: number;
  taskCount: number;
  tasks: readonly SyncTaskResultRow[];
};

// Per-job verdict folded from the per-task results: completed = all completed;
// partial = some completed + some failed; failed = any failed, none completed;
// running otherwise.
function foldJobStatus(tasks: readonly SyncTaskResultRow[]): SyncJobStatusSlug {
  const anyCompleted = tasks.some((t) => t.status === 'completed');
  const anyFailed = tasks.some((t) => t.status === 'failed');
  const allCompleted =
    tasks.length > 0 && tasks.every((t) => t.status === 'completed');

  if (allCompleted) return SyncJobStatus.completed;
  if (anyFailed && anyCompleted) return SyncJobStatus.partial;
  if (anyFailed) return SyncJobStatus.failed;
  return SyncJobStatus.running;
}

export async function getSyncJobResult(
  trx: Tx,
  input: GetSyncJobResultInput
): Promise<SyncJobResultRow> {
  const tasks = await getSyncTaskResults(trx, {
    syncTask: { jobId: input.syncJob.id },
  });

  return {
    jobId: input.syncJob.id,
    status: foldJobStatus(tasks),
    processed: tasks.reduce((sum, t) => sum + (t.processed ?? 0), 0),
    taskCount: tasks.length,
    tasks,
  };
}
