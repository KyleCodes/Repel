import type { Command } from 'commander';
import { accountsService } from '../../features/accounts/service.ts';
import { parseOrExit } from '../lib/parse-or-exit.ts';
import { type BootstrapInput, BootstrapInputSchema } from './schemas/index.ts';

// `orgs` namespace. Line-of-business lifecycle: creating and managing the org
// (and the users inside it). Distinct from `accounts`, which manages the
// provider-account connections a user links to the org.
//
// Today only `bootstrap` is registered. `orgs users { list, add, get }` and
// `orgs show` are planned follow-ups.

export function registerOrgsCommands(program: Command): void {
  const orgs = program
    .command('orgs')
    .description('Organization lifecycle (org + users)');

  orgs
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
