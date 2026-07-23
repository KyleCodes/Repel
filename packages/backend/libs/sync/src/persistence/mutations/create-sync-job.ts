import type { SyncJob } from '@repel/backend-db/prisma/client';
import type {
  SyncJobUncheckedCreateInput,
  SyncTaskUncheckedCreateInput,
} from '@repel/backend-db/prisma/models';
import { type Sql, join, sql } from '@repel/backend-db/sql';
import type { Json, Tx } from '@repel/backend-db/types';
import { SyncEventType } from '@repel/enums';

// Create the job, its tasks, and a per-task `enqueued` event in one statement
// (writeable CTE — raw SQL; the query API cannot chain inserts). org_id is
// written in every row — the RLS policy is USING-only, so each new row must
// carry it. The job row carries its inserted tasks back via json_agg so the
// service returns the DB-confirmed job, camelCase keys aliased in the
// projection.

export const buildCreateSyncJob = (input: CreateSyncJobValues): Sql => {
  const taskRows = join(
    input.tasks.map(
      (t) =>
        sql`(${t.id}, ${t.orgId}, ${t.userId}, ${t.jobId}, ${t.providerAccountId}, ${JSON.stringify(t.spec)}::jsonb)`
    )
  );
  const eventRows = join(
    input.tasks.map(
      (t) =>
        sql`(${t.orgId}, ${t.userId}, ${t.id}, ${SyncEventType.enqueued}::sync_event_type)`
    )
  );
  return sql`
    WITH new_job AS (
      INSERT INTO sync_job (id, org_id, user_id)
      VALUES (${input.syncJob.id}, ${input.syncJob.orgId}, ${input.syncJob.userId})
      RETURNING *
    ), new_tasks AS (
      INSERT INTO sync_task (id, org_id, user_id, job_id, provider_account_id, spec)
      VALUES ${taskRows}
      RETURNING *
    ), new_events AS (
      INSERT INTO sync_task_event (org_id, user_id, task_id, type)
      VALUES ${eventRows}
      RETURNING *
    )
    SELECT
      new_job.id,
      new_job.org_id AS "orgId",
      new_job.user_id AS "userId",
      (SELECT coalesce(json_agg(agg), '[]')
       FROM (SELECT new_tasks.id,
                    new_tasks.provider_account_id AS "providerAccountId",
                    new_tasks.spec
             FROM new_tasks) AS agg) AS "tasks"
    FROM new_job`;
};

export type CreateSyncJobRow = Pick<SyncJob, 'id' | 'orgId' | 'userId'> & {
  tasks: Array<{ id: string; providerAccountId: string; spec: Json }>;
};

// The write shape. The service's public input is the in-memory SyncJob (see
// contract.ts); transform.ts maps it to this. spec is structurally JSON for
// the column, widened to unknown for the in-builder stringify.
export type CreateSyncJobValues = {
  syncJob: Required<
    Pick<SyncJobUncheckedCreateInput, 'id' | 'orgId' | 'userId'>
  >;
  tasks: readonly (Required<
    Pick<
      SyncTaskUncheckedCreateInput,
      'id' | 'orgId' | 'userId' | 'jobId' | 'providerAccountId'
    >
  > & { spec: unknown })[];
};

export async function createSyncJob(
  trx: Tx,
  input: CreateSyncJobValues
): Promise<CreateSyncJobRow> {
  const rows = await trx.$queryRaw<CreateSyncJobRow[]>(
    buildCreateSyncJob(input)
  );
  const row = rows[0];
  if (!row) throw new Error('createSyncJob: statement returned no row');
  return row;
}
