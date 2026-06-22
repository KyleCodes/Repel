import { resolveProviderAdapter as defaultResolveProviderAdapter } from '@repel/backend-adapters/registry';
import type { GmailIngestInput } from '@repel/backend-adapters/types';
import {
  decrypt as defaultDecrypt,
  loadEncryptionKey as defaultLoadEncryptionKey,
} from '@repel/backend-crypto/encryption';
import { accountsService as defaultAccountsService } from '@repel/backend-features/accounts/service';
import { SyncIncompleteStreamError, SyncTaskFailedError } from './error';
import { logSink } from './log-sink';
import type {
  SyncDeps,
  SyncJob,
  SyncJobResult,
  SyncTask,
  SyncTaskContext,
  SyncTaskResult,
  SyncTaskStatus,
} from './types';

// Run a sync job: drive every task's ingest stream concurrently and roll the
// per-task outcomes up into a job result. The executor is the invocation-agnostic
// core — the CLI (v0) and the queue worker (REP-57) both call it. It does no
// persistence itself; each adapter event is handed to a sink (the log sink by
// default; a persisting sink in REP-56).
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
    // runSyncTask catches its own failures and resolves to a failed result, so a
    // rejection here is unexpected — isolate it rather than fail the whole job.
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

  const status: SyncTaskStatus = tasks.every(function (task) {
    return task.status === 'completed';
  })
    ? 'completed'
    : 'failed';

  return { jobId: job.id, status, tasks };
}

// Run one task to a terminal outcome. Resolve the account, decrypt its stored
// credentials, resolve the adapter, then iterate ingest() and feed each event to
// the sink. Any failure — bad credentials, a thrown adapter, or a terminal
// `failed` event — becomes a failed SyncTaskResult; this function never throws,
// so a failing task cannot abort its siblings.
async function runSyncTask(
  job: SyncJob,
  task: SyncTask,
  deps: SyncDeps
): Promise<SyncTaskResult> {
  const accountsService = (deps.accountsService ??
    defaultAccountsService) as typeof defaultAccountsService;
  const resolveProviderAdapter =
    deps.resolveProviderAdapter ?? defaultResolveProviderAdapter;
  const decrypt = deps.decrypt ?? defaultDecrypt;
  const loadEncryptionKey = deps.loadEncryptionKey ?? defaultLoadEncryptionKey;
  const sink = deps.sink ?? logSink;

  const ctx: SyncTaskContext = {
    jobId: job.id,
    orgId: job.orgId,
    userId: job.userId,
    taskId: task.id,
    providerAccountId: task.providerAccountId,
  };

  try {
    // Resolve the provider account (RLS-scoped to job.orgId). A missing row
    // throws ProviderAccountNotFoundError from the service.
    const account = await accountsService.getProviderAccount({
      orgId: job.orgId,
      providerAccount: { id: task.providerAccountId },
    });

    if (account.credentialsEncrypted === null) {
      throw new SyncTaskFailedError(
        `provider account ${task.providerAccountId} has no stored credentials`
      );
    }

    // Decrypt the stored credentials (a bare OAuth token set at rest) and re-tag
    // them with the provider so the adapter narrows without a cast. Plaintext is
    // built here, inside the executor — never handed in by the caller, so a
    // future queue envelope carries only ids.
    const tokens = JSON.parse(
      decrypt(loadEncryptionKey(), account.credentialsEncrypted).toString(
        'utf8'
      )
    );

    const adapter = resolveProviderAdapter(account.provider);

    // Only Gmail exists today; IngestInput is the Gmail member. When a second
    // provider lands this construction widens on account.provider.
    const input: GmailIngestInput = {
      providerSlug: 'gmail',
      orgId: job.orgId,
      userId: job.userId,
      providerAccountId: task.providerAccountId,
      spec: task.spec,
      credentials: { provider: 'gmail', tokens },
    };

    let processed = 0;
    let cursor: unknown = null;
    let terminal: SyncTaskStatus | null = null;
    let failureMessage: string | undefined;

    for await (const event of adapter.ingest(input)) {
      await sink.onEvent(event, ctx);
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
    // The adapter threw mid-stream (e.g. a non-full spec, a terminal refresh
    // failure), or resolve/decrypt failed. Isolate it on the task result.
    return {
      taskId: task.id,
      providerAccountId: task.providerAccountId,
      status: 'failed',
      processed: 0,
      cursor: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
