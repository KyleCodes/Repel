import type { resolveProviderAdapter as DefaultResolveProviderAdapter } from '@repel/backend-adapters/registry';
import type {
  AdapterEvent,
  AdapterSyncSpec,
} from '@repel/backend-adapters/types';
import type {
  decrypt as DefaultDecrypt,
  loadEncryptionKey as DefaultLoadEncryptionKey,
} from '@repel/backend-crypto/encryption';
import type { accountsService as DefaultAccountsService } from '@repel/backend-features/accounts/service';

// The sync job/task model. A job is a unit of sync work for one org/user; each
// task drives one provider account's ingest stream. v0's CLI builds a one-task
// job, but the executor fans out across tasks so the async runner (REP-57) can
// enqueue multi-task jobs without an executor rewrite.
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

// Handed to the sink alongside each event so a sink can scope its work without
// ever seeing the credentials or the adapter. The persisting sink (REP-56) uses
// orgId to open a short per-message transaction; the log sink ignores it.
export interface SyncTaskContext {
  readonly jobId: string;
  readonly orgId: string;
  readonly userId: string;
  readonly taskId: string;
  readonly providerAccountId: string;
}

// Where the executor delivers each adapter event. The executor is sink-agnostic
// and does no persistence itself: v0 ships a log sink; REP-56 swaps in a
// persisting sink that writes the message graph. `onEvent` may be async so a
// sink can await its own (short) DB transaction.
export interface SyncEventSink {
  onEvent(event: AdapterEvent, ctx: SyncTaskContext): void | Promise<void>;
}

export type SyncTaskStatus = 'completed' | 'failed';

// The outcome of one task. `cursor` is the resumption token from the terminal
// `completed` event (null on failure); `error` is the failure message when
// status is 'failed'.
export interface SyncTaskResult {
  readonly taskId: string;
  readonly providerAccountId: string;
  readonly status: SyncTaskStatus;
  readonly processed: number;
  readonly cursor: unknown;
  readonly error?: string;
}

// The job rollup. `completed` iff every task completed; otherwise `failed`.
export interface SyncJobResult {
  readonly jobId: string;
  readonly status: SyncTaskStatus;
  readonly tasks: readonly SyncTaskResult[];
}

// Injectable seams so the executor is unit-testable without a real DB, browser,
// or network. The service/adapter/crypto functions are module-imported, so an
// optional deps param is the contained seam (production calls pass nothing).
// `sink` defaults to the log sink.
export interface SyncDeps {
  accountsService?: Partial<typeof DefaultAccountsService>;
  resolveProviderAdapter?: typeof DefaultResolveProviderAdapter;
  decrypt?: typeof DefaultDecrypt;
  loadEncryptionKey?: typeof DefaultLoadEncryptionKey;
  sink?: SyncEventSink;
}
