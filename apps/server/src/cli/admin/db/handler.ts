import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Command } from 'commander';
import runner from 'node-pg-migrate';
import { resolveAdminUrl } from '../../../db/admin/lib/admin-url.ts';
import {
  cloneDatabase,
  dropDatabase,
  listAppliedMigrations,
  refreshTemplate,
  sanitizeBranchToDbName,
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
  resolveMigrationName,
} from './lib/migrations.ts';
import {
  type CloneInput,
  CloneSchema,
  type DropInput,
  DropSchema,
  type MigrateCreateInput,
  MigrateCreateSchema,
  type MigrateDownInput,
  MigrateDownSchema,
  type MigrateUpInput,
  MigrateUpSchema,
  type RefreshTemplateInput,
  RefreshTemplateSchema,
  type StatusInput,
  StatusSchema,
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
      const input = parseOrExit(CloneSchema, {
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
      const input = parseOrExit(DropSchema, { branch });
      await runDrop(input);
    });

  db.command('refresh-template')
    .description(
      'Drop and recreate the template database (empty — caller runs migrations + seed)'
    )
    .option('--template <name>', 'template database name')
    .action(async function (opts: { template?: string }) {
      const input = parseOrExit(RefreshTemplateSchema, {
        template: opts.template,
      });
      await runRefreshTemplate(input);
    });

  const migrate = db.command('migrate').description('Migration lifecycle');

  migrate
    .command('create [name]')
    .description('Generate a new migration file with a docstring header')
    .action(async function (name: string | undefined) {
      const input = parseOrExit(MigrateCreateSchema, { name });
      await runMigrateCreate(input);
    });

  migrate
    .command('up [target]')
    .description('Apply pending migrations')
    .action(async function (target: string | undefined) {
      const input = parseOrExit(MigrateUpSchema, { target });
      await runMigrateUp(input);
    });

  migrate
    .command('down [target]')
    .description('Roll back applied migrations')
    .action(async function (target: string | undefined) {
      const input = parseOrExit(MigrateDownSchema, { target });
      await runMigrateDown(input);
    });

  db.command('status')
    .description(
      'Diff applied migrations in pgmigrations against the filesystem'
    )
    .action(async function () {
      const input = parseOrExit(StatusSchema, {});
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
  await runner(
    buildRunnerOptions('up', input.target, {
      databaseUrl: readDatabaseUrlFromEnvLocal(),
    })
  );
}

export async function runMigrateDown(input: MigrateDownInput): Promise<void> {
  await runner(
    buildRunnerOptions('down', input.target, {
      databaseUrl: readDatabaseUrlFromEnvLocal(),
    })
  );
}

export async function runStatus(_input: StatusInput): Promise<void> {
  const applied = await listAppliedMigrations(readDatabaseUrlFromEnvLocal());
  const fs = listFsMigrations();
  console.log(renderStatusTable(partitionStatus({ fs, applied })));
}

export { sanitizeBranchToDbName };
