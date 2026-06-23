import { randomUUID } from 'node:crypto';
import type { Command } from 'commander';
import type { AdapterSyncSpec } from '@repel/backend-adapters/types';
import { enqueue as defaultEnqueue } from '@repel/backend-queue/client';
import { runSyncJob as defaultRunSyncJob } from '@repel/backend-sync/handler';
import { syncService as defaultSyncService } from '@repel/backend-sync/service';
import type { SyncJob } from '@repel/backend-sync/types';
import { parseOrExit } from '../lib/parse-or-exit';
import { resolveAccount as defaultResolveAccount } from '../lib/resolve-account';
import { resolveOrgId } from '../lib/resolve-org';
import { resolveUserId } from '../lib/resolve-user';
import { SyncRunFullRequiredError } from './error';
import { type SyncRunInput, SyncRunInputSchema } from './schemas/index';

// `sync` namespace. Drives a provider sync against a connected account.
//
// Default (`sync run`): in-process and synchronous — writes the job/task
// skeleton, then invokes the adapter's ingest() so the executor's persisting
// handler writes the message graph + event log as it streams; prints the
// SyncJobResult. Step-debuggable.
//
// `--enqueue`: writes the same skeleton, then pushes one envelope onto the
// `sync` topic (REP-57) for the sync-worker to run later; prints
// { enqueued, jobId } without running the sync in-process.
//
// The skeleton write (createSyncJob) lives here, not in runSyncJob — the
// executor no longer writes it (so the async worker doesn't write it twice).

// The `sync` topic the worker consumes; the envelope payload is the SyncJob
// working model minus orgId (orgId rides the envelope wrapper).
const SYNC_TOPIC = 'sync';

export function registerSyncCommands(program: Command): void {
  const sync = program.command('sync').description('Run provider syncs');

  sync
    .command('run <account>')
    .description(
      'Run a full sync for one connected account (persists the message graph)'
    )
    .option('--org <id>', 'org id (defaults to REPEL_ORG_ID)')
    .option('--user <id>', 'user id (defaults to REPEL_USER_ID)')
    .option('--full', 'run a full sync (required in v0)')
    .option('--limit <n>', 'dev cap on messages fetched')
    .option(
      '--enqueue',
      'enqueue the job on the sync topic for the worker to run, instead of running it in-process'
    )
    .action(async function (
      account: string,
      opts: {
        org?: string;
        user?: string;
        full?: boolean;
        limit?: string;
        enqueue?: boolean;
      }
    ) {
      const input = parseOrExit(SyncRunInputSchema, {
        org: opts.org,
        user: opts.user,
        account,
        full: opts.full,
        limit: opts.limit,
        enqueue: opts.enqueue,
      });
      await runSyncRun(input);
    });
}

// Injectable seams so the resolve + skeleton + run/enqueue path can be
// unit-tested without a real DB, adapter, or queue (same rationale as the
// accounts handler). Production calls pass nothing.
export interface SyncRunDeps {
  resolveAccount?: typeof defaultResolveAccount;
  createSyncJob?: typeof defaultSyncService.createSyncJob;
  runSyncJob?: typeof defaultRunSyncJob;
  enqueue?: typeof defaultEnqueue;
}

export async function runSyncRun(
  input: SyncRunInput,
  deps: SyncRunDeps = {}
): Promise<void> {
  const resolveAccount = deps.resolveAccount ?? defaultResolveAccount;
  const createSyncJob = deps.createSyncJob ?? defaultSyncService.createSyncJob;
  const runSyncJob = deps.runSyncJob ?? defaultRunSyncJob;
  const enqueue = deps.enqueue ?? defaultEnqueue;

  // v0 supports only full sync. Guard here (not in the schema) so the error is a
  // typed CLI error, mirroring how `accounts connect` guards the auth method.
  if (!input.full) {
    throw new SyncRunFullRequiredError('sync run v0 requires --full');
  }

  const orgId = resolveOrgId(input.org);
  const userId = resolveUserId(input.user);
  const account = await resolveAccount(input.account, { orgId });

  const spec: AdapterSyncSpec = {
    type: 'full',
    ...(input.limit !== undefined && { limit: input.limit }),
  };

  // Build a one-task job. The executor fans out across tasks, but the CLI drives
  // exactly one account; multi-task jobs are the async runner's (REP-57).
  const job: SyncJob = {
    id: randomUUID(),
    orgId,
    userId,
    tasks: [{ id: randomUUID(), providerAccountId: account.id, spec }],
  };

  // Write the skeleton up front (sync_job + sync_task + the per-task `enqueued`
  // event) — both paths need it persisted before any task runs.
  await createSyncJob(job);

  if (input.enqueue) {
    // Enqueue-only: orgId rides the envelope wrapper; the payload is the SyncJob
    // working model the worker rebuilds. dedupKey = job id, so a duplicate
    // enqueue is a no-op. The sync runs later in the worker; status is observed
    // via the sync_event log (a future `sync status`), not this verb.
    const { id, tasks } = job;
    await enqueue(SYNC_TOPIC, { id, userId, tasks }, { orgId, dedupKey: id });
    process.stdout.write(
      JSON.stringify({ enqueued: true, jobId: job.id }) + '\n'
    );
    return;
  }

  // In-process: run the sync now. The per-event human log lines come from the
  // executor's default persisting handler (logs and writes the message graph).
  const result = await runSyncJob(job);

  // Structured summary to stdout (matches the accounts handlers' convention).
  process.stdout.write(JSON.stringify(result) + '\n');
}
