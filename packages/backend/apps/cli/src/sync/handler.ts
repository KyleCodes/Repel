import { randomUUID } from 'node:crypto';
import type { Command } from 'commander';
import type { TokenSet } from '@repel/backend-adapters/lib/oauth2/types';
import { resolveProviderAdapter as defaultResolveProviderAdapter } from '@repel/backend-adapters/registry';
import type { IngestInput } from '@repel/backend-adapters/types';
import {
  decrypt as defaultDecrypt,
  loadEncryptionKey as defaultLoadEncryptionKey,
} from '@repel/backend-crypto/encryption';
import { runSyncJob as defaultRunSyncJob } from '@repel/backend-sync/handler';
import type { SyncJob, SyncTask } from '@repel/backend-sync/types';
import { parseOrExit } from '../lib/parse-or-exit';
import { resolveAccount as defaultResolveAccount } from '../lib/resolve-account';
import { resolveOrgId } from '../lib/resolve-org';
import { AccountCredentialsMissingError } from './error';
import { type SyncRunInput, SyncRunInputSchema } from './schemas/index';

// `sync` namespace. Drives a provider adapter's ingest() against a connected
// account by handing a one-task job to the shared `runSyncJob` handler (the
// future sync-queue-consumer entrypoint). This POC is LOG-ONLY: the handler
// logs each event to stdout and the CLI writes a final JSON summary to stdout —
// nothing is persisted.

export function registerSyncCommands(program: Command): void {
  const sync = program
    .command('sync')
    .description('Run provider syncs against connected accounts');

  sync
    .command('run <account-ref>')
    .description('Drive a full sync for an account and log each event')
    .option('--full', 'run a full sync (required today)')
    .option('--limit <n>', 'cap the number of messages fetched')
    .option('--org <id>', 'org id (defaults to REPEL_ORG_ID)')
    .option('--user <id>', 'user id (defaults to REPEL_USER_ID)')
    .action(async function (
      accountRef: string,
      opts: { full?: boolean; limit?: string; org?: string; user?: string }
    ) {
      const input = parseOrExit(SyncRunInputSchema, {
        accountRef,
        full: opts.full,
        limit: opts.limit,
        org: opts.org,
        user: opts.user,
      });
      await runSyncRun(input);
    });
}

// The decrypted credentials handed to the adapter. The `provider` tag is stamped
// in memory here from the account's provider column; what's stored at rest is a
// bare TokenSet. Declared inline to avoid importing a private gmail path.
interface GmailCredentials {
  readonly provider: 'gmail';
  readonly tokens: TokenSet;
}

// Injectable seams so the run path can be unit-tested without a real DB,
// adapter, or key. There is deliberately NO persistence dependency here — the
// POC writes nothing, and the absent seam is the structural guarantee of that.
// `runSyncJob` is injectable so the CLI test can assert delegation without a
// real adapter.
export interface SyncRunDeps {
  resolveAccount?: typeof defaultResolveAccount;
  resolveProviderAdapter?: typeof defaultResolveProviderAdapter;
  loadEncryptionKey?: typeof defaultLoadEncryptionKey;
  decrypt?: typeof defaultDecrypt;
  runSyncJob?: typeof defaultRunSyncJob;
}

export async function runSyncRun(
  input: SyncRunInput,
  deps: SyncRunDeps = {}
): Promise<void> {
  const resolveAccount = deps.resolveAccount ?? defaultResolveAccount;
  const resolveProviderAdapter =
    deps.resolveProviderAdapter ?? defaultResolveProviderAdapter;
  const loadEncryptionKey = deps.loadEncryptionKey ?? defaultLoadEncryptionKey;
  const decrypt = deps.decrypt ?? defaultDecrypt;
  const runSyncJob = deps.runSyncJob ?? defaultRunSyncJob;

  const orgId = resolveOrgId(input.org);
  const account = await resolveAccount(input.accountRef, { orgId });

  // Fail before any ingest call or stdout write when there is nothing to
  // authenticate with.
  if (account.credentialsEncrypted === null) {
    throw new AccountCredentialsMissingError(
      `account ${account.id} has no stored credentials — connect it first`
    );
  }

  // What is stored at rest is a bare TokenSet; the provider tag is stamped in
  // memory here from the account's provider column.
  const tokens = JSON.parse(
    decrypt(loadEncryptionKey(), account.credentialsEncrypted).toString('utf8')
  ) as TokenSet;
  const credentials: GmailCredentials = { provider: 'gmail', tokens };

  const adapter = resolveProviderAdapter(account.provider);

  const ingestInput: IngestInput = {
    orgId,
    userId: account.userId,
    providerAccountId: account.id,
    providerSlug: 'gmail',
    credentials,
    spec: { type: 'full', limit: input.limit },
  };

  // Modeled as a one-task job today; the worker (REP-57) will iterate many. Ids
  // are minted here — the job is the serializable, secret-free contract, so the
  // CLI reconstructs credentials and hands them to the handler via the task
  // context rather than carrying them on the job.
  const task: SyncTask = {
    id: randomUUID(),
    providerAccountId: account.id,
    spec: ingestInput.spec,
  };
  const job: SyncJob = {
    id: randomUUID(),
    orgId,
    userId: account.userId,
    tasks: [task],
  };

  const results = await runSyncJob(job, {
    resolveTaskContext: async () => ({ adapter, ingestInput }),
  });

  process.stdout.write(
    JSON.stringify({
      processed: results[0].processed,
      cursor: results[0].cursor,
    }) + '\n'
  );
}
