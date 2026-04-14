import type { Command } from 'commander';
import type { AuthMethod, Channel, Provider } from '@repel/shared';
import { makeAccountSetupService } from '../account-setup/service.js';

interface AddAccountOptions {
  orgId: string;
  userId: string;
  provider: string;
  label?: string;
  dryRun: boolean;
}

const PROVIDER_DEFAULTS: Record<string, { channel: Channel; authMethod: AuthMethod }> = {
  gmail: { channel: 'email', authMethod: 'oauth2' },
  icloud: { channel: 'email', authMethod: 'app_password' },
};

export function registerAddAccountCommand(program: Command): void {
  program
    .command('add-account')
    .description('Link a provider account to an existing user')
    .requiredOption('--org-id <id>', 'org UUID')
    .requiredOption('--user-id <id>', 'user UUID')
    .requiredOption('--provider <provider>', 'gmail | icloud')
    .option('--label <label>', 'human-readable label for the account')
    .option('--dry-run', 'print what would happen without making changes', false)
    .action(runAddAccount);
}

async function runAddAccount(opts: AddAccountOptions): Promise<void> {
  const defaults = PROVIDER_DEFAULTS[opts.provider];
  if (!defaults) {
    throw new Error(
      `Unknown provider "${opts.provider}". Supported: ${Object.keys(PROVIDER_DEFAULTS).join(', ')}`
    );
  }

  const channel = defaults.channel;
  const provider = opts.provider as Provider;
  const authMethod = defaults.authMethod;

  if (opts.dryRun) {
    console.log('Dry run — would create connected account:');
    console.log(`  org:        ${opts.orgId}`);
    console.log(`  user:       ${opts.userId}`);
    console.log(`  provider:   ${provider}`);
    console.log(`  channel:    ${channel}`);
    console.log(`  authMethod: ${authMethod}`);
    if (opts.label) console.log(`  label:      ${opts.label}`);
    return;
  }

  const credentials = await promptCredentials(authMethod);

  const account = await makeAccountSetupService().linkProvider({
    orgId: opts.orgId,
    userId: opts.userId,
    channel,
    provider,
    authMethod,
    label: opts.label,
    credentials,
  });

  console.log('Created connected account:');
  console.log(`  id:       ${account.id}`);
  console.log(`  provider: ${account.provider}`);
  console.log(`  channel:  ${account.channel}`);
  if (account.label) console.log(`  label:    ${account.label}`);
}

async function promptCredentials(authMethod: AuthMethod): Promise<Record<string, string>> {
  const { createInterface } = await import('readline');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> =>
    new Promise((resolve) => rl.question(q, resolve));

  try {
    if (authMethod === 'oauth2') {
      console.log('Enter OAuth2 credentials (from Google Cloud Console token exchange):');
      const access_token = await ask('  access_token:  ');
      const refresh_token = await ask('  refresh_token: ');
      const expires_at = await ask('  expires_at (ISO string, or leave blank): ');
      return {
        access_token,
        refresh_token,
        ...(expires_at ? { expires_at } : {}),
      };
    }
    if (authMethod === 'app_password') {
      console.log('Enter app-specific password:');
      const password = await ask('  password: ');
      return { password };
    }
    console.log('Enter API key:');
    const key = await ask('  key: ');
    return { key };
  } finally {
    rl.close();
  }
}
