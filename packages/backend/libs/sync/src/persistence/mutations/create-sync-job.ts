import type { Prisma, SyncJob } from '@repel/backend-db/prisma/client';
import type {
  SyncJobUncheckedCreateInput,
  SyncTaskUncheckedCreateInput,
} from '@repel/backend-db/prisma/models';
import type { Json, Tx } from '@repel/backend-db/types';
import { SyncEventType } from '@repel/enums';

// Create the job, its tasks, and a per-task `enqueued` event as one nested
// write — the ORM idiom for a multi-table graph insert. Prisma issues the
// inserts as separate statements inside the ambient transaction, so the write
// is atomic; the previous single-CTE-statement shape traded away here for
// query-API legibility. org_id is written on every row (RLS USING-only).
export async function createSyncJob(
  trx: Tx,
  input: CreateSyncJobValues
): Promise<CreateSyncJobRow> {
  return trx.syncJob.create({
    data: {
      id: input.syncJob.id,
      orgId: input.syncJob.orgId,
      userId: input.syncJob.userId,
      tasks: {
        create: input.tasks.map((task) => ({
          id: task.id,
          orgId: task.orgId,
          userId: task.userId,
          providerAccountId: task.providerAccountId,
          spec: task.spec as Prisma.InputJsonValue,
          events: {
            create: [
              {
                orgId: task.orgId,
                userId: task.userId,
                type: SyncEventType.enqueued,
              },
            ],
          },
        })),
      },
    },
    select: {
      id: true,
      orgId: true,
      userId: true,
      tasks: { select: { id: true, providerAccountId: true, spec: true } },
    },
  });
}

export type CreateSyncJobRow = Pick<SyncJob, 'id' | 'orgId' | 'userId'> & {
  tasks: Array<{ id: string; providerAccountId: string; spec: Json }>;
};

// The write shape. The service's public input is the in-memory SyncJob (see
// contract.ts); transform.ts maps it to this. spec is structurally JSON for
// the column, widened to unknown for the in-call cast.
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
