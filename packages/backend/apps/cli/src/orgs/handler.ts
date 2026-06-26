import type { Command } from 'commander';
import { accountsService } from '@repel/backend-accounts/service';
import { logger } from '@repel/logger/logger';
import { parseOrExit } from '../lib/parse-or-exit';
import { type BootstrapInput, BootstrapInputSchema } from './schemas/index';

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
    logger.output('Dry run — would create:\n');
    logger.output(`  org:  ${input.orgName}\n`);
    logger.output(
      `  user: ${input.email}${input.name ? ` (${input.name})` : ''}\n`
    );
    return;
  }

  const { org, user } = await accountsService.bootstrap({
    org: { name: input.orgName },
    user: { email: input.email, name: input.name ?? null },
  });

  logger.output('Created org:\n');
  logger.output(`  id:   ${org.id}\n`);
  logger.output(`  name: ${org.name}\n`);
  logger.output('Created user:\n');
  logger.output(`  id:    ${user.id}\n`);
  logger.output(`  email: ${user.email}\n`);
  logger.output('\n');
  logger.output(
    'Save these IDs — you will need them for subsequent commands.\n'
  );
}
