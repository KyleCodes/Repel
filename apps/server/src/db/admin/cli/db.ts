import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Command } from 'commander';
import type { z } from 'zod';
import { resolveAdminUrl } from '../lib/admin-url.ts';
import {
  cloneDatabase,
  dropDatabase,
  refreshTemplate,
  sanitizeBranchToDbName,
} from '../service.ts';
import { CloneInput, DropInput, RefreshTemplateInput } from './schemas/db.ts';

function readAdminUrlFromEnv(): string {
  return resolveAdminUrl({
    pgAdminUrl: process.env.PG_ADMIN_URL,
    databaseUrl: process.env.DATABASE_URL,
  });
}

// Commander .action() is the parse boundary per DR-REP-38-2. The raw positional
// + options object goes through Schema.safeParse, and any validation issue exits
// non-zero with a human-readable message. Handlers receive a single typed input.
function parseOrExit<S extends z.ZodTypeAny>(
  schema: S,
  raw: unknown
): z.infer<S> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const path = issue.path.length ? issue.path.join('.') + ': ' : '';
      console.error(`error: ${path}${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}

export function registerDevDbCommands(program: Command): void {
  const db = program
    .command('db')
    .description('Local development database lifecycle');

  db.command('clone <branch>')
    .description(
      'Clone the template database into a per-branch database and write .env.local'
    )
    .option('--template <name>', 'source template database')
    .option('--env-file <path>', 'path to the .env file to write')
    .option(
      '--force',
      'drop and recreate if the per-branch database already exists'
    )
    .action(async function (
      branch: string,
      opts: { template?: string; envFile?: string; force?: boolean }
    ) {
      const input = parseOrExit(CloneInput, {
        branch,
        template: opts.template,
        envFile: opts.envFile,
        force: opts.force,
      });
      await runClone(input);
    });

  db.command('drop <branch>')
    .description('Drop the per-branch database')
    .action(async function (branch: string) {
      const input = parseOrExit(DropInput, { branch });
      await runDrop(input);
    });

  db.command('refresh-template')
    .description(
      'Drop and recreate the template database (empty — caller runs migrations + seed)'
    )
    .option('--template <name>', 'template database name')
    .action(async function (opts: { template?: string }) {
      const input = parseOrExit(RefreshTemplateInput, {
        template: opts.template,
      });
      await runRefreshTemplate(input);
    });
}

export async function runClone(input: CloneInput): Promise<void> {
  const adminUrl = readAdminUrlFromEnv();
  const { dbName, databaseUrl } = await cloneDatabase({
    adminUrl,
    branch: input.branch,
    template: input.template,
    force: input.force,
  });

  const envPath = resolve(process.cwd(), input.envFile);
  mkdirSync(dirname(envPath), { recursive: true });
  writeFileSync(envPath, `DATABASE_URL=${databaseUrl}\n`, { mode: 0o600 });

  console.error(`db clone: created ${dbName} from ${input.template}`);
  console.error(`db clone: wrote ${envPath}`);
}

export async function runDrop(input: DropInput): Promise<void> {
  const adminUrl = readAdminUrlFromEnv();
  const { dbName, dropped } = await dropDatabase({
    adminUrl,
    branch: input.branch,
  });
  if (dropped) {
    console.error(`db drop: dropped ${dbName}`);
  } else {
    console.error(`db drop: ${dbName} did not exist`);
  }
}

export async function runRefreshTemplate(
  input: RefreshTemplateInput
): Promise<void> {
  const adminUrl = readAdminUrlFromEnv();
  await refreshTemplate({ adminUrl, template: input.template });
  console.error(`db refresh-template: recreated ${input.template} (empty)`);
  console.error(
    `db refresh-template: next steps — run migrations and bootstrap against ${input.template}`
  );
}

export { sanitizeBranchToDbName };
