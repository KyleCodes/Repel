import type { Command } from 'commander';
import { accountSetupService } from './service.ts';

interface BootstrapOptions {
  orgName: string;
  email: string;
  name?: string;
  dryRun: boolean;
}

export function registerBootstrapCommand(program: Command): void {
  program
    .command('bootstrap')
    .description('Create the initial org and admin user')
    .requiredOption('--org-name <name>', 'name of the org')
    .requiredOption('--email <email>', 'admin user email')
    .option('--name <name>', 'admin user display name')
    .option(
      '--dry-run',
      'print what would happen without making changes',
      false
    )
    .action(runBootstrap);
}

async function runBootstrap(opts: BootstrapOptions): Promise<void> {
  if (opts.dryRun) {
    console.log('Dry run — would create:');
    console.log(`  org:  ${opts.orgName}`);
    console.log(`  user: ${opts.email}${opts.name ? ` (${opts.name})` : ''}`);
    return;
  }

  const { org, user } = await accountSetupService.bootstrap({
    orgName: opts.orgName,
    userEmail: opts.email,
    userName: opts.name,
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
