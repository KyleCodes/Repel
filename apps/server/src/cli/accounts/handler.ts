import type { Command } from 'commander';
import { accountsService } from '../../features/accounts/service.ts';
import { parseOrExit } from '../lib/parse-or-exit.ts';
import { type BootstrapInput, BootstrapInputSchema } from './schemas/index.ts';

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
