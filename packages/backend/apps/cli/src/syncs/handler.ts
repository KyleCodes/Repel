import { randomUUID } from 'node:crypto';
import type { Command } from 'commander';
import type { AdapterSyncSpec } from '@repel/backend-adapters/types';
import { enqueue as defaultEnqueue } from '@repel/backend-queue/client';
import { runSyncJob as defaultRunSyncJob } from '@repel/backend-sync/handler';
import { syncService as defaultSyncService } from '@repel/backend-sync/service';
import type { SyncJob } from '@repel/backend-sync/types';
import { logger } from '@repel/logger/logger';
import { parseOrExit } from '../lib/parse-or-exit';
import { resolveAccount as defaultResolveAccount } from '../lib/resolve-account';
import { resolveOrgId } from '../lib/resolve-org';
import { resolveUserId } from '../lib/resolve-user';
import {
  SyncJobNotFoundError,
  SyncRunFullRequiredError,
  SyncRunLimitUnboundedError,
} from './error';
import {
  type SyncRunInput,
  SyncRunInputSchema,
  type SyncsListInput,
  SyncsListInputSchema,
  type SyncsShowInput,
  SyncsShowInputSchema,
} from './schemas/index';
import { registerTasksCommands } from './tasks/handler';

// `syncs` namespace. Drives provider syncs and exposes the read tree over them
// (list/show + nested tasks). The namespace is `syncs` at the CLI surface only —
// the underlying lib, the `sync` queue topic, and the `sync-worker` service keep
// their names.
//
// `syncs run`: in-process and synchronous — writes the job/task skeleton, then
// invokes the adapter's ingest() so the executor's persisting handler writes the
// message graph + event log as it streams; prints the SyncJobResult.
// Step-debuggable. `--enqueue` instead pushes one envelope onto the `sync` topic
// (REP-57) for the sync-worker to run later; prints { enqueued, jobId }.
//
// The skeleton write (createSyncJob) lives here, not in runSyncJob — the
// executor no longer writes it (so the async worker doesn't write it twice).

// The `sync` topic the worker consumes; the envelope payload is the SyncJob
// working model minus orgId (orgId rides the envelope wrapper).
const SYNC_TOPIC = 'sync';

// Default cap for a full sync when neither `--limit` nor `--unbounded` is given.
// The cap lives here (the CLI owns the spec), not in the adapter: a bare
// `--full` stays a safe dev-sized pull; `--unbounded` opts into the whole
// mailbox by omitting the limit. Overridable via `--limit`.
const DEFAULT_FULL_SYNC_CAP = 100;

export function registerSyncsCommands(program: Command): void {
  const syncs = program
    .command('syncs')
    .description('Run and inspect provider syncs');

  syncs
    .command('run')
    .description(
      'Run a full sync for one connected account (persists the message graph)'
    )
    .requiredOption(
      '--account <ref>',
      'account to sync: id, alias, or provider:ext'
    )
    .option('--org <id>', 'org id (defaults to REPEL_ORG_ID)')
    .option('--user <id>', 'user id (defaults to REPEL_USER_ID)')
    .option('--full', 'run a full sync (required in v0)')
    .option(
      '--limit <n>',
      `dev cap on messages fetched (default ${DEFAULT_FULL_SYNC_CAP})`
    )
    .option(
      '--unbounded',
      'pull the whole mailbox (no cap); mutually exclusive with --limit'
    )
    .option(
      '--enqueue',
      'enqueue the job on the sync topic for the worker to run, instead of running it in-process'
    )
    .action(async function (opts: {
      account: string;
      org?: string;
      user?: string;
      full?: boolean;
      limit?: string;
      unbounded?: boolean;
      enqueue?: boolean;
    }) {
      const input = parseOrExit(SyncRunInputSchema, {
        org: opts.org,
        user: opts.user,
        account: opts.account,
        full: opts.full,
        limit: opts.limit,
        unbounded: opts.unbounded,
        enqueue: opts.enqueue,
      });
      await runSyncRun(input);
    });

  syncs
    .command('list')
    .description('List sync jobs for a user (one summary row per job)')
    .option('--org <id>', 'org id (defaults to REPEL_ORG_ID)')
    .option('--user <id>', 'user id (defaults to REPEL_USER_ID)')
    .action(async function (opts: { org?: string; user?: string }) {
      const input = parseOrExit(SyncsListInputSchema, {
        org: opts.org,
        user: opts.user,
      });
      await runSyncsList(input);
    });

  syncs
    .command('show <jobId>')
    .description('Show one sync job with its tasks')
    .option('--org <id>', 'org id (defaults to REPEL_ORG_ID)')
    .action(async function (jobId: string, opts: { org?: string }) {
      const input = parseOrExit(SyncsShowInputSchema, { org: opts.org, jobId });
      await runSyncsShow(input);
    });

  registerTasksCommands(syncs);
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

  // A cap and an uncapped pull are contradictory — reject rather than silently
  // pick one.
  if (input.limit !== undefined && input.unbounded) {
    throw new SyncRunLimitUnboundedError(
      'sync run: --limit and --unbounded are mutually exclusive'
    );
  }

  const orgId = resolveOrgId(input.org);
  const userId = resolveUserId(input.user);
  const account = await resolveAccount(input.account, { orgId });

  // --unbounded omits the cap (adapter paginates to exhaustion). Otherwise cap
  // at --limit, or the default when neither is given.
  const cap = input.unbounded
    ? undefined
    : (input.limit ?? DEFAULT_FULL_SYNC_CAP);
  const spec: AdapterSyncSpec = {
    type: 'full',
    ...(cap !== undefined && { limit: cap }),
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
    // Enqueue-only: the payload is the full SyncJob (orgId also rides the
    // envelope wrapper as the authoritative tenant scope). dedupKey = job id, so
    // a duplicate enqueue is a no-op. The sync runs later in the worker; status
    // is observed via the sync_event log (a future `sync status`), not this verb.
    await enqueue(SYNC_TOPIC, job, { orgId, dedupKey: job.id });
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

  // A failed sync must not look like a success: the JSON above stays on stdout
  // for machine consumers, but also log at error level and set a non-zero exit
  // so a human (and CI) sees the failure. runSyncJob never throws — it folds
  // per-task failures into the result — so this is the only place the CLI can
  // surface them.
  if (result.status === 'failed') {
    logger.error('sync run failed', {
      jobId: result.jobId,
      failedTasks: result.tasks
        .filter((t) => t.status === 'failed')
        .map((t) => ({ taskId: t.taskId, error: t.error })),
    });
    process.exitCode = 1;
  }
}

// Read-verb seams: the service is module-imported, so an optional deps param is
// the contained way to drive these without a real DB (same rationale as
// SyncRunDeps). Production calls pass nothing.
export interface SyncsListDeps {
  listSyncJobs?: typeof defaultSyncService.listSyncJobs;
}

export async function runSyncsList(
  input: SyncsListInput,
  deps: SyncsListDeps = {}
): Promise<void> {
  const listSyncJobs = deps.listSyncJobs ?? defaultSyncService.listSyncJobs;

  // userId is resolved (env fallback) so the verb fails fast with the standard
  // message when neither --user nor REPEL_USER_ID is set; the listing itself is
  // org-scoped by RLS. orgId scopes the read.
  const orgId = resolveOrgId(input.org);
  resolveUserId(input.user);

  const jobs = await listSyncJobs({ orgId });
  process.stdout.write(JSON.stringify(jobs) + '\n');
}

export interface SyncsShowDeps {
  getSyncJobResult?: typeof defaultSyncService.getSyncJobResult;
  listSyncJobs?: typeof defaultSyncService.listSyncJobs;
}

export async function runSyncsShow(
  input: SyncsShowInput,
  deps: SyncsShowDeps = {}
): Promise<void> {
  const getSyncJobResult =
    deps.getSyncJobResult ?? defaultSyncService.getSyncJobResult;
  const listSyncJobs = deps.listSyncJobs ?? defaultSyncService.listSyncJobs;

  const orgId = resolveOrgId(input.org);

  // getSyncJobResult folds from the event log, so an unknown job and a real job
  // with no tasks both return a row (taskCount 0). Check existence against the
  // job list (membership) so an unknown id is a typed not-found, not an empty
  // print. The typed error lives at the CLI boundary; the service stays a fold.
  const jobs = await listSyncJobs({ orgId });
  if (!jobs.some((j) => j.jobId === input.jobId)) {
    throw new SyncJobNotFoundError(`sync job not found: ${input.jobId}`);
  }

  const result = await getSyncJobResult({
    orgId,
    syncJob: { id: input.jobId },
  });
  process.stdout.write(JSON.stringify(result) + '\n');
}
