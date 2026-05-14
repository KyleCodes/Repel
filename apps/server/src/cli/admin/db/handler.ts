import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Command } from 'commander';
import runner from 'node-pg-migrate';
import { migrationsService } from '../../../core/migrations/service.ts';
import { resolveAdminUrl } from '../../../db/admin/lib/admin-url.ts';
import {
  cloneDatabase,
  dropDatabase,
  refreshTemplate,
} from '../../../db/admin/service.ts';
import { parseOrExit } from '../../lib/parse-or-exit.ts';
import { extractTicketSlug, getCurrentBranch } from './lib/branch.ts';
import { readDatabaseUrlFromEnvLocal } from './lib/env-local.ts';
import {
  MIGRATIONS_DIR,
  applyHeaderToFile,
  buildRunnerOptions,
  formatHeader,
  listFsMigrations,
  parseGeneratedPath,
  partitionStatus,
  renderStatusTable,
  resolveMigrationMatch,
  resolveMigrationName,
} from './lib/migrations.ts';
import {
  type CloneInput,
  CloneInputSchema,
  type DropInput,
  DropInputSchema,
  type MigrateCreateInput,
  MigrateCreateInputSchema,
  type MigrateDownInput,
  MigrateDownInputSchema,
  type MigrateUpInput,
  MigrateUpInputSchema,
  type RefreshTemplateInput,
  RefreshTemplateInputSchema,
  type StatusInput,
  StatusInputSchema,
} from './schemas.ts';

function readAdminUrlFromEnv(): string {
  return resolveAdminUrl({
    pgAdminUrl: process.env.PG_ADMIN_URL,
    databaseUrl: process.env.DATABASE_URL,
  });
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
      const input = parseOrExit(CloneInputSchema, {
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
      const input = parseOrExit(DropInputSchema, { branch });
      await runDrop(input);
    });

  db.command('refresh-template')
    .description(
      'Drop and recreate the template database (empty — caller runs migrations + seed)'
    )
    .option('--template <name>', 'template database name')
    .action(async function (opts: { template?: string }) {
      const input = parseOrExit(RefreshTemplateInputSchema, {
        template: opts.template,
      });
      await runRefreshTemplate(input);
    });

  const migrate = db.command('migrate').description('Migration lifecycle');

  migrate
    .command('create [name]')
    .description('Generate a new migration file with a docstring header')
    .action(async function (name: string | undefined) {
      const input = parseOrExit(MigrateCreateInputSchema, { name });
      await runMigrateCreate(input);
    });

  migrate
    .command('up [match]')
    .description(
      'Apply pending migrations. With [match], resolves a unique substring against the filesystem list.'
    )
    .action(async function (match: string | undefined) {
      const input = parseOrExit(MigrateUpInputSchema, { match });
      await runMigrateUp(input);
    });

  migrate
    .command('down [match]')
    .description(
      'Roll back applied migrations. With [match], resolves a unique substring against the filesystem list.'
    )
    .action(async function (match: string | undefined) {
      const input = parseOrExit(MigrateDownInputSchema, { match });
      await runMigrateDown(input);
    });

  db.command('status')
    .description(
      'Diff applied migrations in pgmigrations against the filesystem'
    )
    .action(async function () {
      const input = parseOrExit(StatusInputSchema, {});
      await runStatus(input);
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

export async function runMigrateCreate(
  input: MigrateCreateInput
): Promise<void> {
  const branch = getCurrentBranch();
  const name = resolveMigrationName({ explicit: input.name, branch });
  const stdout = execFileSync(
    'bun',
    [
      '--bun',
      'x',
      'node-pg-migrate',
      'create',
      name,
      '--migrations-dir',
      MIGRATIONS_DIR,
      '--migration-file-language',
      'ts',
    ],
    { encoding: 'utf8' }
  );
  const filePath = parseGeneratedPath(stdout);
  if (!filePath || !existsSync(filePath)) {
    const trimmed = stdout.trim().slice(-200);
    throw new Error(
      `db migrate create: could not locate generated file (stdout tail: ${trimmed})`
    );
  }
  const header = formatHeader({
    name,
    branch,
    ticket: extractTicketSlug(branch),
    createdAt: new Date(),
  });
  applyHeaderToFile(filePath, header);
  console.error(`db migrate create: wrote ${filePath}`);
}

export async function runMigrateUp(input: MigrateUpInput): Promise<void> {
  const resolved = resolveMigrationMatch(input.match, 'up', listFsMigrations());
  await runner(
    buildRunnerOptions('up', resolved, {
      databaseUrl: readDatabaseUrlFromEnvLocal(),
    })
  );
}

export async function runMigrateDown(input: MigrateDownInput): Promise<void> {
  const resolved = resolveMigrationMatch(
    input.match,
    'down',
    listFsMigrations()
  );
  await runner(
    buildRunnerOptions('down', resolved, {
      databaseUrl: readDatabaseUrlFromEnvLocal(),
    })
  );
}

export async function runStatus(_input: StatusInput): Promise<void> {
  const applied = await migrationsService.listApplied();
  const fs = listFsMigrations();
  console.log(
    renderStatusTable(
      partitionStatus({
        fs,
        applied: applied.map(function (a) {
          return a.name;
        }),
      })
    )
  );
}
