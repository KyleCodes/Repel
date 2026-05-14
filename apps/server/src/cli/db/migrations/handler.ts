import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { Command } from 'commander';
import runner from 'node-pg-migrate';
import { parseOrExit } from '../../lib/parse-or-exit.ts';
import { extractTicketSlug, getCurrentBranch } from '../lib/branch.ts';
import { readDatabaseUrlFromEnvLocal } from '../lib/env-local.ts';
import {
  MIGRATIONS_DIR,
  applyHeaderToFile,
  buildRunnerOptions,
  formatHeader,
  listFsMigrations,
  parseGeneratedPath,
  resolveMigrationMatch,
  resolveMigrationName,
} from '../lib/migrations.ts';
import {
  type MigrateCreateInput,
  MigrateCreateInputSchema,
  type MigrateDownInput,
  MigrateDownInputSchema,
  type MigrateUpInput,
  MigrateUpInputSchema,
} from './schemas/index.ts';

export function registerMigrationsCommands(db: Command): void {
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
