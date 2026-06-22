import { randomUUID } from 'node:crypto';
import type { Command } from 'commander';
import type { AdapterSyncSpec } from '@repel/backend-adapters/types';
import { runSyncJob as defaultRunSyncJob } from '@repel/backend-sync/handler';
import type { SyncJob } from '@repel/backend-sync/types';
import { parseOrExit } from '../lib/parse-or-exit';
import { resolveAccount as defaultResolveAccount } from '../lib/resolve-account';
import { resolveOrgId } from '../lib/resolve-org';
import { resolveUserId } from '../lib/resolve-user';
import { SyncRunFullRequiredError } from './error';
import { type SyncRunInput, SyncRunInputSchema } from './schemas/index';

// `sync` namespace. Drives a provider sync against a connected account in-process
// and synchronously: `sync run` invokes the adapter's ingest() and the executor's
// persisting handler writes the message graph + the event log as it streams. No
// queue yet — the async runner (REP-57) will enqueue the same SyncJob shape onto
// the queue instead.

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
    .action(async function (
      account: string,
      opts: { org?: string; user?: string; full?: boolean; limit?: string }
    ) {
      const input = parseOrExit(SyncRunInputSchema, {
        org: opts.org,
        user: opts.user,
        account,
        full: opts.full,
        limit: opts.limit,
      });
      await runSyncRun(input);
    });
}

// Injectable seams so the resolve + executor path can be unit-tested without a
// real DB or adapter (same rationale as the accounts handler). Production calls
// pass nothing.
export interface SyncRunDeps {
  resolveAccount?: typeof defaultResolveAccount;
  runSyncJob?: typeof defaultRunSyncJob;
}

export async function runSyncRun(
  input: SyncRunInput,
  deps: SyncRunDeps = {}
): Promise<void> {
  const resolveAccount = deps.resolveAccount ?? defaultResolveAccount;
  const runSyncJob = deps.runSyncJob ?? defaultRunSyncJob;

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

  const result = await runSyncJob(job);

  // Structured summary to stdout (matches the accounts handlers' convention).
  // The per-event human log lines come from the executor's default handler
  // (the persisting handler, which logs and writes the message graph).
  process.stdout.write(JSON.stringify(result) + '\n');
}
