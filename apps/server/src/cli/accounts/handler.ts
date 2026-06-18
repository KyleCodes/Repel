import type { Command } from 'commander';
import {
  resolveProviderAdapter as defaultResolveProviderAdapter,
  runLoopbackFlow as defaultRunLoopbackFlow,
} from '../../adapters/index.ts';
import { accountsService as defaultAccountsService } from '../../features/accounts/service.ts';
import {
  decrypt,
  encrypt,
  loadEncryptionKey,
} from '../../lib/crypto/encryption.ts';
import { confirm } from '../lib/confirm.ts';
import { parseOrExit } from '../lib/parse-or-exit.ts';
import { resolveAccount } from '../lib/resolve-account.ts';
import { resolveOrgId } from '../lib/resolve-org.ts';
import { resolveUserId } from '../lib/resolve-user.ts';
import {
  AccountIdentityMismatchError,
  UnsupportedAuthMethodError,
} from './error.ts';
import {
  type AccountConnectInput,
  AccountConnectInputSchema,
  type AccountListInput,
  AccountListInputSchema,
  type AccountReconnectInput,
  AccountReconnectInputSchema,
  type AccountRmInput,
  AccountRmInputSchema,
  type AccountShowInput,
  AccountShowInputSchema,
} from './schemas/index.ts';

// `accounts` namespace. Provider-account connections: the Gmail/iCloud logins
// a user links to an org. Distinct from `orgs`, which owns org + user
// lifecycle (the `bootstrap` verb lives there).
//
// Today `list`, `show`, `rm`, `connect`, and `reconnect` are registered.
// `connect` runs the real interactive OAuth flow to link a new account;
// `reconnect` re-runs it for an existing account to rotate its credentials.

export function registerAccountsCommands(program: Command): void {
  const accounts = program
    .command('accounts')
    .description('Provider account connections');

  accounts
    .command('list')
    .description('List provider accounts for a user')
    .option('--org <id>', 'org id (defaults to REPEL_ORG_ID)')
    .option('--user <id>', 'user id (defaults to REPEL_USER_ID)')
    .action(async function (opts: { org?: string; user?: string }) {
      const input = parseOrExit(AccountListInputSchema, {
        org: opts.org,
        user: opts.user,
      });
      await runAccountsList(input);
    });

  accounts
    .command('show <account>')
    .description('Show one provider account (by id, alias, or provider:ext)')
    .option('--org <id>', 'org id (defaults to REPEL_ORG_ID)')
    .action(async function (account: string, opts: { org?: string }) {
      const input = parseOrExit(AccountShowInputSchema, {
        org: opts.org,
        account,
      });
      await runAccountsShow(input);
    });

  accounts
    .command('rm <account>')
    .description('Deactivate a provider account (soft delete)')
    .option('--org <id>', 'org id (defaults to REPEL_ORG_ID)')
    .option('-y, --yes', 'skip the confirmation prompt')
    .action(async function (
      account: string,
      opts: { org?: string; yes?: boolean }
    ) {
      const input = parseOrExit(AccountRmInputSchema, {
        org: opts.org,
        account,
        yes: opts.yes,
      });
      await runAccountsRm(input);
    });

  accounts
    .command('connect <provider>')
    .description('Connect a new provider account via interactive OAuth')
    .option('--org <id>', 'org id (defaults to REPEL_ORG_ID)')
    .option('--user <id>', 'user id (defaults to REPEL_USER_ID)')
    .option('--alias <name>', 'human label for the account')
    .action(async function (
      provider: string,
      opts: { org?: string; user?: string; alias?: string }
    ) {
      const input = parseOrExit(AccountConnectInputSchema, {
        org: opts.org,
        user: opts.user,
        provider,
        alias: opts.alias,
      });
      await runAccountsConnect(input);
    });

  accounts
    .command('reconnect <account>')
    .description(
      'Re-run OAuth for an existing account (by id, alias, or provider:ext) and rotate its credentials'
    )
    .option('--org <id>', 'org id (defaults to REPEL_ORG_ID)')
    .action(async function (account: string, opts: { org?: string }) {
      const input = parseOrExit(AccountReconnectInputSchema, {
        org: opts.org,
        account,
      });
      await runAccountsReconnect(input);
    });
}

// Structured output convention: a JSON document on a single line to stdout
// (matches `db query`). Diagnostics and prompts go to stderr.

export async function runAccountsList(input: AccountListInput): Promise<void> {
  const orgId = resolveOrgId(input.org);
  const userId = resolveUserId(input.user);
  const accounts = await defaultAccountsService.listProviderAccounts({
    orgId,
    providerAccount: { userId },
  });
  process.stdout.write(JSON.stringify(accounts) + '\n');
}

export async function runAccountsShow(input: AccountShowInput): Promise<void> {
  const orgId = resolveOrgId(input.org);
  const account = await resolveAccount(input.account, { orgId });
  // Decrypt the stored credentials for display. The operator running the CLI is
  // already trusted, so this is an inspection aid, not a leak — and a row that
  // won't decrypt (wrong key / tampered) throws through the CLI error boundary.
  // The raw `credentialsEncrypted` bytes are dropped from the output in favour
  // of the decrypted `credentials` object.
  const { credentialsEncrypted, ...rest } = account;
  const credentials =
    credentialsEncrypted === null
      ? null
      : JSON.parse(
          decrypt(loadEncryptionKey(), credentialsEncrypted).toString('utf8')
        );
  const out = { ...rest, credentials };
  process.stdout.write(JSON.stringify(out) + '\n');
}

export async function runAccountsRm(input: AccountRmInput): Promise<void> {
  const orgId = resolveOrgId(input.org);
  const account = await resolveAccount(input.account, { orgId });
  const label = account.alias ?? account.id;
  if (!input.yes) {
    const ok = await confirm(`Deactivate ${label}? [y/N] `);
    if (!ok) {
      console.error('accounts rm: cancelled');
      return;
    }
  }
  await defaultAccountsService.deactivateProviderAccount({
    orgId,
    providerAccount: { id: account.id },
  });
  console.error(`accounts rm: deactivated ${account.id}`);
}

// Injectable seams so the OAuth + persistence path can be unit-tested without
// touching a real browser, network, or database. The two adapter functions and
// the service are module-imported, so a fetch/spy seam can't reach them cleanly
// (and mock.module mutates the registry process-globally); an optional deps
// param is the contained, justified seam. Production calls pass nothing.
export interface AccountsConnectDeps {
  resolveProviderAdapter?: typeof defaultResolveProviderAdapter;
  runLoopbackFlow?: typeof defaultRunLoopbackFlow;
  accountsService?: Partial<typeof defaultAccountsService>;
}

export async function runAccountsConnect(
  input: AccountConnectInput,
  deps: AccountsConnectDeps = {}
): Promise<void> {
  const resolveProviderAdapter =
    deps.resolveProviderAdapter ?? defaultResolveProviderAdapter;
  const runLoopbackFlow = deps.runLoopbackFlow ?? defaultRunLoopbackFlow;
  const accountsService = (deps.accountsService ??
    defaultAccountsService) as typeof defaultAccountsService;

  // Fail-fast on scope before any OAuth work: a missing org/user should never
  // open a browser. `input.provider` is already ProviderSlug (the schema's enum).
  const orgId = resolveOrgId(input.org);
  const userId = resolveUserId(input.user);
  const { provider } = input;

  const adapter = resolveProviderAdapter(provider);
  if (adapter.auth.method !== 'oauth2') {
    throw new UnsupportedAuthMethodError(
      `provider ${provider} uses ${adapter.auth.method} auth; only oauth2 is supported by accounts connect`
    );
  }

  // Run interactive OAuth FIRST, then insert. Awaiting the authorization before
  // the insert means a timeout, denial, or cancellation rejects with no row
  // written — there is nothing to clean up.
  const authorization = await runLoopbackFlow(adapter.auth, {
    provider,
    orgId,
    userId,
  });

  // Encrypt the credentials before they reach the DB (AES-256-GCM, key from
  // ENCRYPTION_KEY). The credentials_encrypted column holds ciphertext, never
  // plaintext. A missing/invalid key throws here, after OAuth but before the
  // insert — nothing is written.
  const credentialsEncrypted = encrypt(
    loadEncryptionKey(),
    Buffer.from(JSON.stringify(authorization.credentials), 'utf8')
  );

  const account = await accountsService.addProviderAccount({
    orgId,
    providerAccount: {
      orgId,
      userId,
      provider,
      channel: adapter.capabilities.channel,
      authMethod: authorization.authMethod,
      externalAccountId: authorization.externalAccountId,
      alias: input.alias,
      credentialsEncrypted,
    },
  });

  // Print only non-secret identifiers — never the credentials.
  process.stdout.write(
    JSON.stringify({
      id: account.id,
      alias: account.alias,
      externalAccountId: account.externalAccountId,
    }) + '\n'
  );
}

// Same seam rationale as AccountsConnectDeps: the adapter functions, the
// service, and resolveAccount are module-imported and can't be spied cleanly,
// so reconnect takes an optional deps param. Production calls pass nothing.
export interface AccountsReconnectDeps {
  resolveProviderAdapter?: typeof defaultResolveProviderAdapter;
  runLoopbackFlow?: typeof defaultRunLoopbackFlow;
  resolveAccount?: typeof resolveAccount;
  accountsService?: Partial<typeof defaultAccountsService>;
}

export async function runAccountsReconnect(
  input: AccountReconnectInput,
  deps: AccountsReconnectDeps = {}
): Promise<void> {
  const resolveProviderAdapter =
    deps.resolveProviderAdapter ?? defaultResolveProviderAdapter;
  const runLoopbackFlow = deps.runLoopbackFlow ?? defaultRunLoopbackFlow;
  const resolveAccountFn = deps.resolveAccount ?? resolveAccount;
  const accountsService = (deps.accountsService ??
    defaultAccountsService) as typeof defaultAccountsService;

  // Resolve the existing row FIRST — a bad token fails before any OAuth work.
  const orgId = resolveOrgId(input.org);
  const account = await resolveAccountFn(input.account, { orgId });

  const adapter = resolveProviderAdapter(account.provider);
  if (adapter.auth.method !== 'oauth2') {
    throw new UnsupportedAuthMethodError(
      `provider ${account.provider} uses ${adapter.auth.method} auth; only oauth2 is supported by accounts reconnect`
    );
  }

  // Re-run interactive OAuth, scoped to the existing account's owner. Same
  // ordering guarantee as connect: a timeout/denial rejects with no write.
  const authorization = await runLoopbackFlow(adapter.auth, {
    provider: account.provider,
    orgId,
    userId: account.userId,
  });

  // Identity guard: the fresh authorization MUST be for the same external
  // account. Otherwise the operator authorized the wrong login and rotating
  // would silently repoint the row at a different mailbox — reject, write
  // nothing.
  if (authorization.externalAccountId !== account.externalAccountId) {
    throw new AccountIdentityMismatchError(
      `reconnect authorized ${account.provider}:${authorization.externalAccountId}, but ${account.id} is ${account.provider}:${account.externalAccountId}`
    );
  }

  // Encrypt the rotated credentials, then replace them in place on the existing
  // row — the id, alias, and owner are preserved. Key errors throw here, after
  // OAuth but before the update — nothing is written.
  const credentialsEncrypted = encrypt(
    loadEncryptionKey(),
    Buffer.from(JSON.stringify(authorization.credentials), 'utf8')
  );

  const updated = await accountsService.updateProviderAccountCredentials({
    orgId,
    providerAccount: { id: account.id, credentialsEncrypted },
  });

  // Print only non-secret identifiers — never the credentials.
  process.stdout.write(
    JSON.stringify({
      id: updated.id,
      alias: updated.alias,
      externalAccountId: updated.externalAccountId,
    }) + '\n'
  );
}
