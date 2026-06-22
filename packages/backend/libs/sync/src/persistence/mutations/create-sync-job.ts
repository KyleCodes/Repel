import { type InferResult, type Insertable } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import type { Json, SyncJob, SyncTask } from '@repel/backend-db/generated';
import type { Tx } from '@repel/backend-db/types';
import { SyncEventType } from '@repel/enums';

// Create the job, its tasks, and a per-task `enqueued` event in one statement
// (writeable CTE). org_id is written in every .values() — the RLS policy is
// USING-only, so each new row must carry it. The job row carries its inserted
// tasks back via jsonArrayFrom so the service returns the DB-confirmed job.
export const buildCreateSyncJob = (trx: Tx, input: CreateSyncJobValues) =>
  trx
    .with('new_job', (qb) =>
      qb.insertInto('syncJob').values(input.syncJob).returningAll()
    )
    .with('new_tasks', (qb) =>
      qb
        .insertInto('syncTask')
        .values(input.tasks.map((t) => ({ ...t, spec: t.spec as Json })))
        .returningAll()
    )
    .with('new_events', (qb) =>
      qb
        .insertInto('syncTaskEvent')
        .values(
          input.tasks.map((task) => ({
            orgId: task.orgId,
            userId: task.userId,
            taskId: task.id,
            type: SyncEventType.enqueued,
          }))
        )
        .returningAll()
    )
    .selectFrom('new_job')
    .select((eb) => [
      'new_job.id',
      'new_job.orgId',
      'new_job.userId',
      jsonArrayFrom(
        eb
          .selectFrom('new_tasks')
          .select([
            'new_tasks.id',
            'new_tasks.providerAccountId',
            'new_tasks.spec',
          ])
      ).as('tasks'),
    ]);

export type CreateSyncJobRow = InferResult<
  ReturnType<typeof buildCreateSyncJob>
>[number];

// The kysely write shape. The service's public input is the in-memory SyncJob
// (see contract.ts); transform.ts maps it to this. spec is structurally JSON for
// the column, cast in the builder.
export type CreateSyncJobValues = {
  syncJob: Insertable<SyncJob>;
  // id required (the CLI supplies the PK so events/raws can FK it); spec widened
  // to unknown for the in-builder cast to the jsonb column.
  tasks: readonly (Omit<Insertable<SyncTask>, 'spec' | 'id'> & {
    id: string;
    spec: unknown;
  })[];
};

export async function createSyncJob(
  trx: Tx,
  input: CreateSyncJobValues
): Promise<CreateSyncJobRow> {
  return buildCreateSyncJob(trx, input).executeTakeFirstOrThrow();
}
