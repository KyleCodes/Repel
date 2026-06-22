import type { AdapterSyncSpec } from '@repel/backend-adapters/types';
import type { CreateSyncJobInput, CreateSyncJobResult } from './contract';
import type {
  CreateSyncJobRow,
  CreateSyncJobValues,
} from './mutations/create-sync-job';

// Maps between the service's public interfaces (contract.ts) and the kysely query
// shapes (mutations/, views/). One input map + one output map per diverging
// method. The query layer never sees the public types; the service never builds
// kysely shapes by hand.

export function toCreateSyncJobValues(
  input: CreateSyncJobInput
): CreateSyncJobValues {
  return {
    syncJob: { id: input.id, orgId: input.orgId, userId: input.userId },
    tasks: input.tasks.map((task) => ({
      id: task.id,
      orgId: input.orgId,
      userId: input.userId,
      jobId: input.id,
      providerAccountId: task.providerAccountId,
      spec: task.spec,
    })),
  };
}

// Returns the created job, all columns DB-confirmed from the inserted rows. spec
// comes back as opaque Json from the jsonb column and is re-narrowed to the
// executor's AdapterSyncSpec (the value round-trips unchanged from the input).
export function toCreateSyncJobResult(
  row: CreateSyncJobRow
): CreateSyncJobResult {
  return {
    id: row.id,
    orgId: row.orgId,
    userId: row.userId,
    tasks: row.tasks.map((task) => ({
      id: task.id,
      providerAccountId: task.providerAccountId,
      spec: task.spec as AdapterSyncSpec,
    })),
  };
}
