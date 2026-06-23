import { runInOrgTx } from '@repel/backend-db/tx';
import type {
  CreateSyncJobInput,
  CreateSyncJobResult,
  GetSyncJobResultInput,
  GetSyncTaskInput,
  GetSyncTaskResultInput,
  ListTaskEventsInput,
} from './contract';
import { createSyncJob } from './mutations/create-sync-job';
import {
  type PersistEventInput,
  persistEvent,
} from './mutations/persist-event';
import {
  type PersistMessageInput,
  persistMessage,
} from './mutations/persist-message';
import { toCreateSyncJobResult, toCreateSyncJobValues } from './transform';
import {
  type SyncJobResultRow,
  getSyncJobResult,
} from './views/get-sync-job-result';
import {
  type SyncTaskResultRow,
  getSyncTaskResults,
} from './views/get-sync-task-results';
import { type SyncJobBaseRow, listSyncJobs } from './views/list-sync-jobs';
import { type TaskEventRow, listTaskEvents } from './views/list-task-events';

export type { PersistEventInput } from './mutations/persist-event';
export type {
  PersistMessageInput,
  PersistMessageRaw,
  PersistMessageBody,
  PersistMessageParticipant,
  PersistMessageAttachment,
} from './mutations/persist-message';
export type { SyncJobResultRow } from './views/get-sync-job-result';
export type { SyncTaskResultRow } from './views/get-sync-task-results';
export type { TaskEventRow } from './views/list-task-events';

// The light per-job summary `listSyncJobs` returns: the bare sync_job columns
// plus the per-job derived fold (status/taskCount/processed). The fold is reused
// from getSyncJobResult — see the method comment for the N+1 note.
export type SyncJobSummaryRow = SyncJobBaseRow &
  Pick<SyncJobResultRow, 'status' | 'taskCount' | 'processed'>;

// persistMessage / persistEvent each run in their own short transaction (one per
// adapter event) — a full sync is minutes long and must never hold one tx open.
export const syncService = {
  createSyncJob: runInOrgTx(async function (
    trx,
    input: CreateSyncJobInput
  ): Promise<CreateSyncJobResult> {
    return toCreateSyncJobResult(
      await createSyncJob(trx, toCreateSyncJobValues(input))
    );
  }),

  persistMessage: runInOrgTx(async function (trx, input: PersistMessageInput) {
    return persistMessage(trx, input);
  }),

  persistEvent: runInOrgTx(async function (trx, input: PersistEventInput) {
    return persistEvent(trx, input);
  }),

  getSyncTaskResults: runInOrgTx(async function (
    trx,
    input: GetSyncTaskResultInput
  ): Promise<SyncTaskResultRow[]> {
    return getSyncTaskResults(trx, input);
  }),

  getSyncJobResult: runInOrgTx(async function (
    trx,
    input: GetSyncJobResultInput
  ): Promise<SyncJobResultRow> {
    return getSyncJobResult(trx, input);
  }),

  // Lists every org job as a light summary. MVP folds status/taskCount/processed
  // per job by calling getSyncJobResult in a loop — N+1, but inside one org tx
  // (N queries, one transaction). Replace with a set-based fold post-MVP; the
  // light-row shape is the contract, the implementation behind it can change.
  listSyncJobs: runInOrgTx(async function (trx): Promise<SyncJobSummaryRow[]> {
    const bases = await listSyncJobs(trx);
    const summaries: SyncJobSummaryRow[] = [];
    for (const base of bases) {
      const { status, taskCount, processed } = await getSyncJobResult(trx, {
        syncJob: { id: base.jobId },
      });
      summaries.push({ ...base, status, taskCount, processed });
    }
    return summaries;
  }),

  // One task by id, validated against its job. getSyncTaskResults is jobId-scoped,
  // so a taskId not under that job is simply absent from the array — find returns
  // undefined, which the caller maps to a typed not-found. No dedicated single-row
  // view yet (the reuse is the MVP; a thin where-taskId select is a later seam).
  getSyncTaskResult: runInOrgTx(async function (
    trx,
    input: GetSyncTaskInput
  ): Promise<SyncTaskResultRow | undefined> {
    const tasks = await getSyncTaskResults(trx, {
      syncTask: { jobId: input.syncTask.jobId },
    });
    return tasks.find((t) => t.taskId === input.syncTask.id);
  }),

  // The raw event log for one task, oldest first. Membership (task belongs to the
  // path job) is validated by the caller before this runs; this returns the audit
  // trail unfiltered.
  listTaskEvents: runInOrgTx(async function (
    trx,
    input: ListTaskEventsInput
  ): Promise<TaskEventRow[]> {
    return listTaskEvents(trx, input);
  }),
};
