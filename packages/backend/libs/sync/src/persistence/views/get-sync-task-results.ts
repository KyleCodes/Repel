import { type InferResult, sql } from 'kysely';
import type { Tx } from '@repel/backend-db/types';
import { SyncTaskStatus, type SyncTaskStatusSlug } from '@repel/enums';

export type GetSyncTaskResultInput = {
  syncTask: { jobId: string };
};

// Per-task outcome, derived entirely from the sync_task_event log (sync_task
// holds no status/cursor columns). One distinctOn pass collapses the log to the
// latest event per (task, type); the per-field lookups read from it. error is
// read from the latest *failed* event, not the terminal one — a task can
// complete after an earlier failure, so terminal != failed there.
function latestEventPerType(trx: Tx) {
  return trx
    .selectFrom('syncTaskEvent as e')
    .distinctOn(['e.taskId', 'e.type'])
    .orderBy('e.taskId')
    .orderBy('e.type')
    .orderBy('e.createdAt', 'desc')
    .select(['e.taskId', 'e.type', 'e.payload', 'e.createdAt']);
}

function buildGetSyncTaskResults(trx: Tx, input: GetSyncTaskResultInput) {
  return (
    trx
      .with('latest', () => latestEventPerType(trx))
      .selectFrom('syncTask as t')
      // The terminal event is the newest of completed|failed — one lateral folds
      // both candidates to a single status + completedAt.
      .leftJoinLateral(
        (eb) =>
          eb
            .selectFrom('latest')
            .whereRef('latest.taskId', '=', 't.id')
            .where('latest.type', 'in', ['completed', 'failed'])
            .orderBy('latest.createdAt', 'desc')
            .limit(1)
            .select(['latest.type as terminalType', 'latest.createdAt'])
            .as('terminal'),
        (join) => join.onTrue()
      )
      .leftJoin('latest as completedEvt', (join) =>
        join
          .onRef('completedEvt.taskId', '=', 't.id')
          .on('completedEvt.type', '=', 'completed')
      )
      .leftJoin('latest as progressEvt', (join) =>
        join
          .onRef('progressEvt.taskId', '=', 't.id')
          .on('progressEvt.type', '=', 'progress')
      )
      .leftJoin('latest as startedEvt', (join) =>
        join
          .onRef('startedEvt.taskId', '=', 't.id')
          .on('startedEvt.type', '=', 'started')
      )
      .leftJoin('latest as failedEvt', (join) =>
        join
          .onRef('failedEvt.taskId', '=', 't.id')
          .on('failedEvt.type', '=', 'failed')
      )
      .where('t.jobId', '=', input.syncTask.jobId)
      .select((eb) => [
        't.id as taskId',
        't.jobId as jobId',
        't.providerAccountId as providerAccountId',
        eb.ref('terminal.terminalType').as('terminalType'),
        eb.fn
          .coalesce(
            // JSON text -> int casts: the one bit the builder can't express.
            sql<number>`(completed_evt.payload->>'processed')::int`,
            sql<number>`(progress_evt.payload->>'processed')::int`,
            sql<number>`0`
          )
          .as('processed'),
        sql<unknown>`completed_evt.payload->'cursor'`.as('cursor'),
        eb.ref('startedEvt.createdAt').as('startedAt'),
        eb.ref('terminal.createdAt').as('completedAt'),
        sql<string | null>`failed_evt.payload->>'error'`.as('error'),
      ])
  );
}

type SyncTaskResultQueryRow = InferResult<
  ReturnType<typeof buildGetSyncTaskResults>
>[number];

// The public row: the derived terminalType is folded to a status slug.
export type SyncTaskResultRow = Omit<SyncTaskResultQueryRow, 'terminalType'> & {
  status: SyncTaskStatusSlug;
};

export async function getSyncTaskResults(
  trx: Tx,
  input: GetSyncTaskResultInput
): Promise<SyncTaskResultRow[]> {
  const rows = await buildGetSyncTaskResults(trx, input).execute();
  return rows.map(function ({ terminalType, ...rest }): SyncTaskResultRow {
    const status: SyncTaskStatusSlug =
      terminalType === SyncTaskStatus.completed
        ? SyncTaskStatus.completed
        : terminalType === SyncTaskStatus.failed
          ? SyncTaskStatus.failed
          : SyncTaskStatus.running;
    return { ...rest, status };
  });
}
