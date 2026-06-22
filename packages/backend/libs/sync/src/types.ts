import type { AdapterEvent } from '@repel/backend-adapters/types';
import type { SyncTaskStatusSlug } from '@repel/enums';
import type { SyncJob, SyncTask } from './persistence/contract';

// Re-exported so executor-facing consumers get the working model from the same
// entrypoint as the handler types. contract.ts is the source of truth.
export type { SyncJob, SyncTask } from './persistence/contract';

// The executor-facing types. The working model (SyncJob/SyncTask) is owned by
// persistence/contract.ts (derived from the generated row types); the handler
// contract below references the adapter event stream it consumes.

export interface SyncContext {
  readonly syncJob: SyncJob;
  readonly syncTask: SyncTask;
}

export interface SyncEventHandler {
  handle(event: AdapterEvent, ctx: SyncContext): void | Promise<void>;
}

// The executor's in-memory rollup of a run, built from Promise.allSettled — a
// transient outcome, distinct from the event-log-derived view rows in
// persistence/views (which carry timestamps the rollup never sees). A task the
// executor returns is always terminal, so its status is the completed|failed
// subset of the derived SyncTaskStatusSlug.
export type SyncTerminalStatus = Extract<
  SyncTaskStatusSlug,
  'completed' | 'failed'
>;

export interface SyncTaskResult {
  readonly taskId: string;
  readonly providerAccountId: string;
  readonly status: SyncTerminalStatus;
  readonly processed: number;
  readonly cursor: unknown;
  readonly error?: string;
}

export interface SyncJobResult {
  readonly jobId: string;
  readonly status: SyncTerminalStatus;
  readonly tasks: readonly SyncTaskResult[];
}
