import type { SyncEventType } from '@repel/backend-db/prisma/enums';
import { type Sql, sql } from '@repel/backend-db/sql';
import type { Tx } from '@repel/backend-db/types';
import { SyncTaskStatus, type SyncTaskStatusSlug } from '@repel/enums';

export type GetSyncTaskResultInput = {
  syncTask: { jobId: string };
};

// Per-task outcome, derived entirely from the sync_task_event log (sync_task
// holds no status/cursor columns). One DISTINCT ON pass collapses the log to
// the latest event per (task, type); the per-field lookups read from it. error
// is read from the latest *failed* event, not the terminal one — a task can
// complete after an earlier failure, so terminal != failed there. The terminal
// event is the newest of completed|failed — one LATERAL folds both candidates
// to a single status + completedAt.
//
// DISTINCT ON + LATERAL + jsonb path casts are Postgres-only and outside the
// query API — raw SQL, transcribed from the Kysely builder with camelCase
// aliases in the projection.
export const buildGetSyncTaskResults = (
  input: GetSyncTaskResultInput
): Sql => sql`
  WITH latest AS (
    SELECT DISTINCT ON (e.task_id, e.type)
           e.task_id, e.type, e.payload, e.created_at
    FROM sync_task_event AS e
    ORDER BY e.task_id, e.type, e.created_at DESC
  )
  SELECT
    t.id AS "taskId",
    t.job_id AS "jobId",
    t.provider_account_id AS "providerAccountId",
    terminal.terminal_type AS "terminalType",
    coalesce((completed_evt.payload->>'processed')::int,
             (progress_evt.payload->>'processed')::int,
             0) AS "processed",
    completed_evt.payload->'cursor' AS "cursor",
    started_evt.created_at AS "startedAt",
    terminal.created_at AS "completedAt",
    failed_evt.payload->>'error' AS "error"
  FROM sync_task AS t
  LEFT JOIN LATERAL (
    SELECT latest.type AS terminal_type, latest.created_at
    FROM latest
    WHERE latest.task_id = t.id AND latest.type IN ('completed', 'failed')
    ORDER BY latest.created_at DESC
    LIMIT 1
  ) AS terminal ON true
  LEFT JOIN latest AS completed_evt
    ON completed_evt.task_id = t.id AND completed_evt.type = 'completed'
  LEFT JOIN latest AS progress_evt
    ON progress_evt.task_id = t.id AND progress_evt.type = 'progress'
  LEFT JOIN latest AS started_evt
    ON started_evt.task_id = t.id AND started_evt.type = 'started'
  LEFT JOIN latest AS failed_evt
    ON failed_evt.task_id = t.id AND failed_evt.type = 'failed'
  WHERE t.job_id = ${input.syncTask.jobId}`;

type SyncTaskResultQueryRow = {
  taskId: string;
  jobId: string;
  providerAccountId: string;
  terminalType: SyncEventType | null;
  processed: number;
  cursor: unknown;
  startedAt: Date | null;
  completedAt: Date | null;
  error: string | null;
};

// The public row: the derived terminalType is folded to a status slug.
export type SyncTaskResultRow = Omit<SyncTaskResultQueryRow, 'terminalType'> & {
  status: SyncTaskStatusSlug;
};

export async function getSyncTaskResults(
  trx: Tx,
  input: GetSyncTaskResultInput
): Promise<SyncTaskResultRow[]> {
  const rows = await trx.$queryRaw<SyncTaskResultQueryRow[]>(
    buildGetSyncTaskResults(input)
  );
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
