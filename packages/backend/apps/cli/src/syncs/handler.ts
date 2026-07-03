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
  SyncRunLimitUnboundedError,
  SyncRunNoCursorError,
  SyncRunRangeBoundsError,
} from './error';
import {
  type SyncRunFullInput,
  SyncRunFullInputSchema,
  type SyncRunIncrementalInput,
  SyncRunIncrementalInputSchema,
  type SyncRunRangeInput,
  SyncRunRangeInputSchema,
  type SyncRunSharedInput,
  SyncRunSharedInputSchema,
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
// `syncs run <mode>`: in-process and synchronous — writes the job/task skeleton,
// then invokes the adapter's ingest() so the executor's persisting handler writes
// the message graph + event log as it streams; prints the SyncJobResult.
// Step-debuggable. `--enqueue` instead pushes one envelope onto the `sync` topic
// (REP-57) for the sync-worker to run later; prints { enqueued, jobId }.
//
// The mode is a subcommand (full / incremental / range) so invalid flag combos
// are structurally impossible and each mode gets its own `--help`. The shared
// options (--account/--org/--user/--enqueue) sit on the parent `run` command;
// each subcommand reads them via cmd.parent.opts().
//
// The skeleton write (createSyncJob) lives here, not in runSyncJob — the
// executor no longer writes it (so the async worker doesn't write it twice).

// The `sync` topic the worker consumes; the envelope payload is the SyncJob
// working model minus orgId (orgId rides the envelope wrapper).
const SYNC_TOPIC = 'sync';

// Default cap for a full sync when neither `--limit` nor `--unbounded` is given.
// The cap lives here (the CLI owns the spec), not in the adapter: a bare
// `full` stays a safe dev-sized pull; `--unbounded` opts into the whole mailbox
// by omitting the limit. Overridable via `--limit`.
const DEFAULT_FULL_SYNC_CAP = 100;

export function registerSyncsCommands(program: Command): void {
  const syncs = program
    .command('syncs')
    .description('Run and inspect provider syncs');

  // Parent `run` carries the options every mode shares; the three subcommands add
  // only their own flags. Invoking `run` bare (no subcommand) prints help.
  const run = syncs
    .command('run')
    .description(
      'Run a sync for one connected account (full / incremental / range)'
    )
    .requiredOption(
      '--account <ref>',
      'account to sync: id, alias, or provider:ext'
    )
    .option('--org <id>', 'org id (defaults to REPEL_ORG_ID)')
    .option('--user <id>', 'user id (defaults to REPEL_USER_ID)')
    .option(
      '--enqueue',
      'enqueue the job on the sync topic for the worker to run, instead of running it in-process'
    );

  run
    .command('full')
    .description('Pull the whole mailbox (or a capped slice) from scratch')
    .option(
      '--limit <n>',
      `dev cap on messages fetched (default ${DEFAULT_FULL_SYNC_CAP})`
    )
    .option(
      '--unbounded',
      'pull the whole mailbox (no cap); mutually exclusive with --limit'
    )
    .action(async function (
      opts: { limit?: string; unbounded?: boolean },
      cmd: Command
    ) {
      const shared = parseSharedOrExit(cmd);
      const input = parseOrExit(SyncRunFullInputSchema, {
        limit: opts.limit,
        unbounded: opts.unbounded,
      });
      await runSyncFull(shared, input);
    });

  run
    .command('incremental')
    .description(
      'Resume from the last completed sync, pulling only newer messages'
    )
    .option('--since <iso>', 'override: start from this ISO 8601 instant')
    .option('--cursor <json>', 'override: resume from this raw cursor JSON')
    .action(async function (
      opts: { since?: string; cursor?: string },
      cmd: Command
    ) {
      const shared = parseSharedOrExit(cmd);
      const input = parseOrExit(SyncRunIncrementalInputSchema, {
        since: opts.since,
        cursor: opts.cursor,
      });
      await runSyncIncremental(shared, input);
    });

  run
    .command('range')
    .description('Pull a bounded window by message date')
    .option('--from <iso>', 'window start (ISO 8601), inclusive')
    .option('--to <iso>', 'window end (ISO 8601), exclusive')
    .action(async function (
      opts: { from?: string; to?: string },
      cmd: Command
    ) {
      const shared = parseSharedOrExit(cmd);
      const input = parseOrExit(SyncRunRangeInputSchema, {
        from: opts.from,
        to: opts.to,
      });
      await runSyncRange(shared, input);
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

// Parse the parent `run` command's shared options. Each subcommand's action
// receives its own Command; the shared flags live one level up, so read them off
// `cmd.parent`. parseOrExit surfaces a bad/missing --account as a typed CLI exit.
function parseSharedOrExit(cmd: Command): SyncRunSharedInput {
  const parent = cmd.parent;
  const opts = (parent?.opts() ?? {}) as {
    account?: string;
    org?: string;
    user?: string;
    enqueue?: boolean;
  };
  return parseOrExit(SyncRunSharedInputSchema, {
    account: opts.account,
    org: opts.org,
    user: opts.user,
    enqueue: opts.enqueue,
  });
}

// Injectable seams so the resolve + skeleton + run/enqueue path can be
// unit-tested without a real DB, adapter, or queue (same rationale as the
// accounts handler). Production calls pass nothing. getLatestCompletedCursor
// feeds the incremental auto-resume path.
export interface SyncRunDeps {
  resolveAccount?: typeof defaultResolveAccount;
  createSyncJob?: typeof defaultSyncService.createSyncJob;
  runSyncJob?: typeof defaultRunSyncJob;
  enqueue?: typeof defaultEnqueue;
  getLatestCompletedCursor?: typeof defaultSyncService.getLatestCompletedCursor;
}

// The mode-agnostic tail shared by all three subcommands: resolve org/user/
// account, build a one-task job for the given spec, persist the skeleton, then
// either enqueue it or run it in-process (surfacing a failed run as a non-zero
// exit). Only the AdapterSyncSpec differs per mode; that is built by the caller.
async function runResolvedSync(
  spec: AdapterSyncSpec,
  shared: SyncRunSharedInput,
  deps: SyncRunDeps
): Promise<void> {
  const resolveAccount = deps.resolveAccount ?? defaultResolveAccount;
  const createSyncJob = deps.createSyncJob ?? defaultSyncService.createSyncJob;
  const runSyncJob = deps.runSyncJob ?? defaultRunSyncJob;
  const enqueue = deps.enqueue ?? defaultEnqueue;

  const orgId = resolveOrgId(shared.org);
  const userId = resolveUserId(shared.user);
  const account = await resolveAccount(shared.account, { orgId });

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

  if (shared.enqueue) {
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

// `syncs run full` — pull the whole mailbox, or a capped slice.
export async function runSyncFull(
  shared: SyncRunSharedInput,
  input: SyncRunFullInput,
  deps: SyncRunDeps = {}
): Promise<void> {
  // A cap and an uncapped pull are contradictory — reject rather than silently
  // pick one.
  if (input.limit !== undefined && input.unbounded) {
    throw new SyncRunLimitUnboundedError(
      'sync run full: --limit and --unbounded are mutually exclusive'
    );
  }

  // --unbounded omits the cap (adapter paginates to exhaustion). Otherwise cap
  // at --limit, or the default when neither is given.
  const cap = input.unbounded
    ? undefined
    : (input.limit ?? DEFAULT_FULL_SYNC_CAP);
  const spec: AdapterSyncSpec = {
    type: 'full',
    ...(cap !== undefined && { limit: cap }),
  };
  await runResolvedSync(spec, shared, deps);
}

// `syncs run range` — pull a bounded window by message date. At least one bound
// is required; an unbounded range is a full sync, which has its own subcommand.
export async function runSyncRange(
  shared: SyncRunSharedInput,
  input: SyncRunRangeInput,
  deps: SyncRunDeps = {}
): Promise<void> {
  if (input.from === undefined && input.to === undefined) {
    throw new SyncRunRangeBoundsError(
      'sync run range: at least one of --from / --to is required'
    );
  }
  const spec: AdapterSyncSpec = {
    type: 'range',
    ...(input.from !== undefined && { from: input.from }),
    ...(input.to !== undefined && { to: input.to }),
  };
  await runResolvedSync(spec, shared, deps);
}

// `syncs run incremental` — resume from the last completed sync. Cursor
// resolution order: --cursor (raw JSON) > --since (→ { lastInternalDate }) >
// the account's latest completed cursor. None → a typed no-cursor error (never a
// silent full sync).
export async function runSyncIncremental(
  shared: SyncRunSharedInput,
  input: SyncRunIncrementalInput,
  deps: SyncRunDeps = {}
): Promise<void> {
  const resolveAccount = deps.resolveAccount ?? defaultResolveAccount;
  const getLatestCompletedCursor =
    deps.getLatestCompletedCursor ??
    defaultSyncService.getLatestCompletedCursor;

  const orgId = resolveOrgId(shared.org);
  const account = await resolveAccount(shared.account, { orgId });

  const cursor = await resolveCursor(input, {
    orgId,
    accountId: account.id,
    getLatestCompletedCursor,
  });
  const spec: AdapterSyncSpec = { type: 'incremental', cursor };
  await runResolvedSync(spec, shared, deps);
}

// Resolve the incremental resumption cursor from the override flags, else the
// stored latest-completed cursor for the account. Throws SyncRunNoCursorError
// when nothing is available so the caller never silently full-syncs.
async function resolveCursor(
  input: SyncRunIncrementalInput,
  ctx: {
    orgId: string;
    accountId: string;
    getLatestCompletedCursor: typeof defaultSyncService.getLatestCompletedCursor;
  }
): Promise<unknown> {
  // `--cursor` wins: a raw cursor JSON object passed straight to the adapter.
  if (input.cursor !== undefined) {
    return JSON.parse(input.cursor);
  }
  // `--since`: an ISO start, shaped into the Gmail cursor the adapter expects.
  if (input.since !== undefined) {
    return { lastInternalDate: input.since };
  }
  // Auto-resume from the account's most recent completed sync.
  const row = await ctx.getLatestCompletedCursor({
    orgId: ctx.orgId,
    providerAccount: { id: ctx.accountId },
  });
  if (row?.cursor === undefined || row.cursor === null) {
    throw new SyncRunNoCursorError(
      'sync run incremental: no prior completed sync to resume from; run `syncs run full` first, or pass --since / --cursor'
    );
  }
  return row.cursor;
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
