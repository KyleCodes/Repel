import type { AdapterSyncSpec } from '@repel/backend-adapters/types';

// A sync job and its tasks, modeled in memory. These are serializable and
// secret-free: credentials are never carried here — the consumer resolves and
// decrypts them at execution time via RunSyncJobDeps.resolveTaskContext.

export interface SyncTask {
  readonly id: string;
  readonly providerAccountId: string;
  readonly spec: AdapterSyncSpec;
}

export interface SyncJob {
  readonly id: string;
  readonly orgId: string;
  readonly userId: string;
  readonly tasks: readonly SyncTask[];
}
