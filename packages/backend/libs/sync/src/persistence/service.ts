import { runInOrgTx } from '@repel/backend-db/tx';
import type {
  CreateSyncJobInput,
  CreateSyncJobResult,
  GetSyncJobResultInput,
  GetSyncTaskResultInput,
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

export type { PersistEventInput } from './mutations/persist-event';
export type {
  PersistMessageInput,
  PersistMessageRaw,
  PersistMessageBody,
  PersistMessageParticipant,
  PersistMessageAttachment,
} from './mutations/persist-message';

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
};
