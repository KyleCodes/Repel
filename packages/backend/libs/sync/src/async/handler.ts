import { accountsService as defaultAccountsService } from '@repel/backend-accounts/service';
import { resolveProviderAdapter as defaultResolveProviderAdapter } from '@repel/backend-adapters/registry';
import type {
  IngestInput,
  ProviderCredentials,
} from '@repel/backend-adapters/types';
import {
  decrypt as defaultDecrypt,
  loadEncryptionKey as defaultLoadEncryptionKey,
} from '@repel/backend-crypto/encryption';
import { SyncIncompleteStreamError, SyncTaskFailedError } from '../error';
import type { SyncJob, SyncTask } from '../persistence/contract';
import { createFailedEvent } from '../persistence/lib/events';
import { syncService as defaultSyncService } from '../persistence/service';
import type {
  SyncContext,
  SyncEventHandler,
  SyncJobResult,
  SyncTaskResult,
  SyncTerminalStatus,
} from '../types';
import { syncEventHandler } from './sync-event-handler';

// Injectable seams so the executor is unit-testable without a real DB or network.
export interface SyncDeps {
  accountsService?: typeof defaultAccountsService;
  syncService?: typeof defaultSyncService;
  resolveProviderAdapter?: typeof defaultResolveProviderAdapter;
  decrypt?: typeof defaultDecrypt;
  loadEncryptionKey?: typeof defaultLoadEncryptionKey;
  handler?: SyncEventHandler;
}

// Run a sync job: drive every task's ingest stream concurrently and roll the
// per-task outcomes up into a job result. The job/task skeleton (sync_job +
// sync_task + the per-task `enqueued` event) must already be persisted by the
// caller — the in-process `sync run` verb calls createSyncJob before this, and
// the async path writes it in the enqueuer (REP-57) so the worker doesn't write
// it twice (a second insert on the same sync_job.id is a duplicate-PK failure).
export async function runSyncJob(
  job: SyncJob,
  deps: SyncDeps = {}
): Promise<SyncJobResult> {
  const settled = await Promise.allSettled(
    job.tasks.map(function (task) {
      return runSyncTask(job, task, deps);
    })
  );

  const tasks: SyncTaskResult[] = settled.map(function (outcome, index) {
    if (outcome.status === 'fulfilled') {
      return outcome.value;
    }
    // runSyncTask never throws, so a rejection here is unexpected — isolate it.
    const task = job.tasks[index]!;
    return {
      taskId: task.id,
      providerAccountId: task.providerAccountId,
      status: 'failed',
      processed: 0,
      cursor: null,
      error:
        outcome.reason instanceof Error
          ? outcome.reason.message
          : String(outcome.reason),
    };
  });

  const status: SyncTerminalStatus = tasks.every(function (task) {
    return task.status === 'completed';
  })
    ? 'completed'
    : 'failed';

  return { jobId: job.id, status, tasks };
}

// Run one task to a terminal outcome. Never throws — a failure becomes a failed
// SyncTaskResult so a failing task cannot abort its siblings.
async function runSyncTask(
  job: SyncJob,
  task: SyncTask,
  deps: SyncDeps
): Promise<SyncTaskResult> {
  const accountsService = deps.accountsService ?? defaultAccountsService;
  const resolveProviderAdapter =
    deps.resolveProviderAdapter ?? defaultResolveProviderAdapter;
  const decrypt = deps.decrypt ?? defaultDecrypt;
  const loadEncryptionKey = deps.loadEncryptionKey ?? defaultLoadEncryptionKey;
  const handler = deps.handler ?? syncEventHandler;

  const ctx: SyncContext = { syncJob: job, syncTask: task };

  try {
    const account = await accountsService.getProviderAccount({
      orgId: job.orgId,
      providerAccount: { id: task.providerAccountId },
    });

    if (account.credentialsEncrypted === null) {
      throw new SyncTaskFailedError(
        `provider account ${task.providerAccountId} has no stored credentials`
      );
    }

    const adapter = resolveProviderAdapter(account.provider);

    // The stored blob is trusted (written by the connect flow); the platform
    // never interprets the credential shape — the adapter does.
    const credentials = JSON.parse(
      decrypt(loadEncryptionKey(), account.credentialsEncrypted).toString(
        'utf8'
      )
    ) as ProviderCredentials;

    // resolveProviderAdapter already validated the slug, so the IngestInput
    // narrowing is sound.
    const input = {
      providerSlug: account.provider,
      orgId: job.orgId,
      userId: job.userId,
      providerAccountId: task.providerAccountId,
      spec: task.spec,
      credentials,
    } as IngestInput;

    let processed = 0;
    let cursor: unknown = null;
    let terminal: SyncTerminalStatus | null = null;
    let failureMessage: string | undefined;

    for await (const event of adapter.ingest(input)) {
      await handler.handle(event, ctx);
      if (event.type === 'progress') {
        processed = event.processed;
      } else if (event.type === 'completed') {
        processed = event.processed;
        cursor = event.cursor;
        terminal = 'completed';
      } else if (event.type === 'failed') {
        terminal = 'failed';
        failureMessage = event.error.message;
      }
    }

    if (terminal === null) {
      throw new SyncIncompleteStreamError(
        `task ${task.id} stream ended without a terminal event`
      );
    }
    if (terminal === 'failed') {
      return {
        taskId: task.id,
        providerAccountId: task.providerAccountId,
        status: 'failed',
        processed,
        cursor: null,
        error: failureMessage ?? 'adapter reported failure',
      };
    }
    return {
      taskId: task.id,
      providerAccountId: task.providerAccountId,
      status: 'completed',
      processed,
      cursor,
    };
  } catch (e) {
    // The adapter emitted no `failed` event for the handler to persist (it threw,
    // or the stream had no terminal event), so write the terminal failed event
    // here — otherwise the derived status would stay `running`. Best-effort.
    const err = e instanceof Error ? e : new Error(String(e));
    try {
      await createFailedEvent(
        { orgId: job.orgId, userId: job.userId, taskId: task.id },
        { error: err }
      );
    } catch {
      // The task result below is the source of truth for the caller.
    }
    return {
      taskId: task.id,
      providerAccountId: task.providerAccountId,
      status: 'failed',
      processed: 0,
      cursor: null,
      error: err.message,
    };
  }
}
