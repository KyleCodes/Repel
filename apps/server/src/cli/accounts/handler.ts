import type { Command } from 'commander';
import { accountsService } from '../../features/accounts/service.ts';
import { confirm } from '../lib/confirm.ts';
import { parseOrExit } from '../lib/parse-or-exit.ts';
import { resolveAccount } from '../lib/resolve-account.ts';
import { resolveOrgId } from '../lib/resolve-org.ts';
import { resolveUserId } from '../lib/resolve-user.ts';
import {
  type AccountAddInput,
  AccountAddInputSchema,
  type AccountListInput,
  AccountListInputSchema,
  type AccountRmInput,
  AccountRmInputSchema,
  type AccountShowInput,
  AccountShowInputSchema,
} from './schemas/index.ts';

// `accounts` namespace. Provider-account connections: the Gmail/iCloud logins
// a user links to an org. Distinct from `orgs`, which owns org + user
// lifecycle (the `bootstrap` verb lives there).
//
// Today `list`, `show`, `rm`, and `add` are registered (`add` is stubbed —
// the token flow lands in REP-22).

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
    .command('add <provider>')
    .description('Add a provider account (stubbed — token flow is REP-22)')
    .option('--org <id>', 'org id (defaults to REPEL_ORG_ID)')
    .option('--user <id>', 'user id (defaults to REPEL_USER_ID)')
    .action(async function (
      provider: string,
      opts: { org?: string; user?: string }
    ) {
      const input = parseOrExit(AccountAddInputSchema, {
        org: opts.org,
        user: opts.user,
        provider,
      });
      await runAccountsAdd(input);
    });
}

// Structured output convention: a JSON document on a single line to stdout
// (matches `db query`). Diagnostics and prompts go to stderr.

export async function runAccountsList(input: AccountListInput): Promise<void> {
  const orgId = resolveOrgId(input.org);
  const userId = resolveUserId(input.user);
  const rows = await accountsService.listProviderAccounts({ orgId, userId });
  process.stdout.write(JSON.stringify(rows) + '\n');
}

export async function runAccountsShow(input: AccountShowInput): Promise<void> {
  const orgId = resolveOrgId(input.org);
  const row = await resolveAccount(input.account, { orgId });
  // Replace the raw credential bytes with their base64 string (or null).
  // No other masking — the operator running the CLI is already trusted.
  const credentials = row.credentialsEncrypted;
  const out = {
    ...row,
    credentialsEncrypted:
      credentials === null ? null : credentials.toString('base64'),
  };
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
  await accountsService.deactivateProviderAccount({ orgId, id: account.id });
  console.error(`accounts rm: deactivated ${account.id}`);
}

export async function runAccountsAdd(input: AccountAddInput): Promise<void> {
  // Resolve scope so a misconfigured invocation fails the same way the real
  // verb will — but the OAuth/token flow itself is out of scope (REP-22).
  resolveOrgId(input.org);
  resolveUserId(input.user);
  throw new Error(
    `token flow for ${input.provider} not yet implemented — see REP-22`
  );
}
