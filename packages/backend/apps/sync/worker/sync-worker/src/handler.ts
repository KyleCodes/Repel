import type { Envelope } from '@repel/backend-queue/types';
import { runSyncJob as defaultRunSyncJob } from '@repel/backend-sync/handler';
import type { SyncJob } from '@repel/backend-sync/types';

// The envelope payload the enqueuer writes is the full SyncJob working model.
// orgId is denormalized into both the payload and the envelope wrapper (the
// queue's tenancy model); the handler trusts the wrapper's orgId as the
// authoritative tenant scope.
export type SyncJobPayload = SyncJob;

// Injectable seam so the handler is unit-testable without a real DB/adapter.
export interface SyncHandlerDeps {
  runSyncJob?: typeof defaultRunSyncJob;
}

// The work the sync-worker's consumer runs per `sync` envelope: rebuild the
// SyncJob (the payload, with orgId taken from the envelope wrapper) and delegate
// to the executor. The skeleton (sync_job/sync_task/enqueued event) was already
// written by the enqueuer, so the executor assumes it exists (REP-57). Thin by
// design — no business logic; the executor owns adapter resolution, decryption,
// ingest, and the message-graph + event-log writes.
export function makeSyncHandler(deps: SyncHandlerDeps = {}) {
  const runSyncJob = deps.runSyncJob ?? defaultRunSyncJob;

  return async function syncHandler(envelope: Envelope): Promise<void> {
    const payload = envelope.payload as SyncJobPayload;
    const job: SyncJob = { ...payload, orgId: envelope.orgId };
    await runSyncJob(job);
  };
}

// The production handler (default deps).
export const syncHandler = makeSyncHandler();
