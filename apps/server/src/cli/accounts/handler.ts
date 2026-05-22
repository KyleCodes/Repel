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
  type BootstrapInput,
  BootstrapInputSchema,
} from './schemas/index.ts';

// `accounts` namespace. An "account" is the business unit — an org plus the
// users inside it. In B2C an account contains one user; in B2B it contains
// many. The CLI vocabulary unifies them under one namespace; internally the
// service splits org and user rows (see Rule 4 — facade reshapes wire).
//
// Today only `bootstrap` is registered. `accounts list`, `accounts get`, and
// `accounts users { list, add, get }` are planned follow-ups.

export function registerAccountsCommands(program: Command): void {
  const accounts = program
    .command('accounts')
    .description('Account lifecycle (org + users)');

  accounts
    .command('bootstrap')
    .description('Create the initial account (first org and admin user)')
    .requiredOption('--org-name <name>', 'name of the org')
    .requiredOption('--email <email>', 'admin user email')
    .option('--name <name>', 'admin user display name')
    .option(
      '--dry-run',
      'print what would happen without making changes',
      false
    )
    .action(async function (opts: {
      orgName: string;
      email: string;
      name?: string;
      dryRun: boolean;
    }) {
      const input = parseOrExit(BootstrapInputSchema, opts);
      await runBootstrap(input);
    });

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

export async function runBootstrap(input: BootstrapInput): Promise<void> {
  if (input.dryRun) {
    console.log('Dry run — would create:');
    console.log(`  org:  ${input.orgName}`);
    console.log(
      `  user: ${input.email}${input.name ? ` (${input.name})` : ''}`
    );
    return;
  }

  const { org, user } = await accountsService.bootstrap({
    orgName: input.orgName,
    userEmail: input.email,
    userName: input.name,
  });

  console.log('Created org:');
  console.log(`  id:   ${org.id}`);
  console.log(`  name: ${org.name}`);
  console.log('Created user:');
  console.log(`  id:    ${user.id}`);
  console.log(`  email: ${user.email}`);
  console.log('');
  console.log('Save these IDs — you will need them for subsequent commands.');
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
