import type { Envelope } from '@repel/backend-queue/types';
import { runSyncJob as defaultRunSyncJob } from '@repel/backend-sync/handler';
import type { SyncJob } from '@repel/backend-sync/types';

// The envelope payload the enqueuer writes: the SyncJob working model minus
// orgId. orgId rides the envelope wrapper (the queue's tenancy-in-payload model),
// so it is not duplicated here; the handler rebuilds the full SyncJob from both.
export type SyncJobPayload = Omit<SyncJob, 'orgId'>;

// Injectable seam so the handler is unit-testable without a real DB/adapter.
export interface SyncHandlerDeps {
  runSyncJob?: typeof defaultRunSyncJob;
}

// The work the sync-worker's consumer runs per `sync` envelope: rebuild the
// SyncJob (payload + the envelope's orgId) and delegate to the executor. The
// skeleton (sync_job/sync_task/enqueued event) was already written by the
// enqueuer, so the executor assumes it exists (REP-57). Thin by design — no
// business logic; the executor owns adapter resolution, decryption, ingest, and
// the message-graph + event-log writes.
export function makeSyncHandler(deps: SyncHandlerDeps = {}) {
  const runSyncJob = deps.runSyncJob ?? defaultRunSyncJob;

  return async function syncHandler(envelope: Envelope): Promise<void> {
    const { id, userId, tasks } = envelope.payload as SyncJobPayload;
    const job: SyncJob = { id, orgId: envelope.orgId, userId, tasks };
    await runSyncJob(job);
  };
}

// The production handler (default deps).
export const syncHandler = makeSyncHandler();
