import type { Selectable } from 'kysely';
import type { AdapterSyncSpec } from '@repel/backend-adapters/types';
import type {
  SyncJob as SyncJobTbl,
  SyncTask as SyncTaskTbl,
} from '@repel/backend-db/generated';

// The sync persistence service's public contract: the executor working model
// the service accepts/returns, surfaced to the rest of the sync module. The
// query layer (mutations/views) owns its own input + kysely-inferred result
// types; this file imports those it exposes and re-exports them upward.
export type { GetSyncTaskResultInput } from './views/get-sync-task-results';
export type { GetSyncJobResultInput } from './views/get-sync-job-result';
export type { ListTaskEventsInput } from './views/list-task-events';
export type { GetLatestCompletedCursorInput } from './views/get-latest-completed-cursor';

// One task by id, scoped to its parent job — the job id validates membership
// (a task id not under the job is treated as not-found). Distinct from
// GetSyncTaskResultInput, which scopes a whole job's task list.
export type GetSyncTaskInput = {
  syncTask: { jobId: string; id: string };
};

// The executor's in-memory working model, derived from the generated row types
// so the columns track the schema. spec is opaque Json in the table; the
// executor sees the discriminated AdapterSyncSpec. SyncTask.id is the persisted
// sync_task.id (the CLI generates it and passes it as the row PK).
export type SyncTask = Pick<
  Selectable<SyncTaskTbl>,
  'id' | 'providerAccountId'
> & { readonly spec: AdapterSyncSpec };

export type SyncJob = Pick<
  Selectable<SyncJobTbl>,
  'id' | 'orgId' | 'userId'
> & {
  readonly tasks: readonly SyncTask[];
};

// createSyncJob takes the in-memory SyncJob directly — the service derives every
// per-row column (orgId, userId, jobId) from it and returns the inserted job.
export type CreateSyncJobInput = SyncJob;

export type CreateSyncJobResult = SyncJob;
