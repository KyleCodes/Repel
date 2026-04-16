import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Command } from 'commander';
import {
  cloneDatabase,
  dropDatabase,
  refreshTemplate,
  sanitizeBranchToDbName,
} from './service.js';

const DEFAULT_TEMPLATE = 'repel_dev';

interface CloneOptions {
  template: string;
  envFile: string;
  force: boolean;
}

interface DropOptions {
  // none yet
}

interface RefreshOptions {
  template: string;
}

export function registerDevDbCommands(program: Command): void {
  const db = program.command('db').description('Local development database lifecycle');

  db.command('clone <branch>')
    .description('Clone the template database into a per-branch database and write .env.local')
    .option('--template <name>', 'source template database', DEFAULT_TEMPLATE)
    .option('--env-file <path>', 'path to the .env file to write', '.env.local')
    .option('--force', 'drop and recreate if the per-branch database already exists', false)
    .action(runClone);

  db.command('drop <branch>')
    .description('Drop the per-branch database')
    .action(runDrop);

  db.command('refresh-template')
    .description('Drop and recreate the template database (empty — caller runs migrations + seed)')
    .option('--template <name>', 'template database name', DEFAULT_TEMPLATE)
    .action(runRefresh);
}

async function runClone(branch: string, opts: CloneOptions): Promise<void> {
  const { dbName, databaseUrl } = await cloneDatabase({
    branch,
    template: opts.template,
    force: opts.force,
  });

  const envPath = resolve(process.cwd(), opts.envFile);
  mkdirSync(dirname(envPath), { recursive: true });
  writeFileSync(envPath, `DATABASE_URL=${databaseUrl}\n`, { mode: 0o600 });

  // Status to stderr so stdout stays clean for any caller that captures it.
  console.error(`db clone: created ${dbName} from ${opts.template}`);
  console.error(`db clone: wrote ${envPath}`);
}

async function runDrop(branch: string, _opts: DropOptions): Promise<void> {
  const { dbName, dropped } = await dropDatabase({ branch });
  if (dropped) {
    console.error(`db drop: dropped ${dbName}`);
  } else {
    console.error(`db drop: ${dbName} did not exist`);
  }
}

async function runRefresh(opts: RefreshOptions): Promise<void> {
  await refreshTemplate({ template: opts.template });
  console.error(`db refresh-template: recreated ${opts.template} (empty)`);
  console.error(`db refresh-template: next steps — run migrations and bootstrap against ${opts.template}`);
}

export { sanitizeBranchToDbName };
