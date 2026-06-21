import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { Command } from 'commander';
import runner from 'node-pg-migrate';
import { parseOrExit } from '../../lib/parse-or-exit';
import { extractTicketSlug, getCurrentBranch } from '../lib/branch';
import { runCodegen } from '../lib/codegen';
import { readDatabaseUrlFromEnvLocal } from '../lib/env-local';
import {
  MIGRATIONS_DIR,
  applyHeaderToFile,
  buildRunnerOptions,
  formatHeader,
  listFsMigrations,
  parseGeneratedPath,
  resolveMigrationMatch,
  resolveMigrationName,
} from '../lib/migrations';
import {
  type MigrateCreateInput,
  MigrateCreateInputSchema,
  type MigrateDownInput,
  MigrateDownInputSchema,
  type MigrateUpInput,
  MigrateUpInputSchema,
} from './schemas/index';

export function registerMigrationsCommands(db: Command): void {
  const migrate = db.command('migrations').description('Migration lifecycle');

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
      'Roll back applied migrations. With [match], resolves a unique substring against the filesystem list. With --base, rolls back to base (all).'
    )
    .option('-b, --base', 'Roll back every applied migration (to base)')
    .action(async function (
      match: string | undefined,
      options: { base?: boolean }
    ) {
      const input = parseOrExit(MigrateDownInputSchema, {
        match,
        base: options.base,
      });
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
      `db migrations create: could not locate generated file (stdout tail: ${trimmed})`
    );
  }
  const header = formatHeader({
    name,
    branch,
    ticket: extractTicketSlug(branch),
    createdAt: new Date(),
  });
  applyHeaderToFile(filePath, header);
  console.log(`db migrations create: wrote ${filePath}`);
}

export async function runMigrateUp(input: MigrateUpInput): Promise<void> {
  const resolved = resolveMigrationMatch(input.match, 'up', listFsMigrations());
  await runner(
    buildRunnerOptions('up', resolved, {
      databaseUrl: readDatabaseUrlFromEnvLocal(),
    })
  );
  // Regenerate infra/db/generated.ts so the Kysely types reflect the schema
  // change just applied. Keeps the committed types from drifting.
  await runCodegen();
}

export async function runMigrateDown(input: MigrateDownInput): Promise<void> {
  const resolved = resolveMigrationMatch(
    input.match,
    'down',
    listFsMigrations(),
    input.base
  );
  await runner(
    buildRunnerOptions('down', resolved, {
      databaseUrl: readDatabaseUrlFromEnvLocal(),
    })
  );
  // Regenerate types to reflect the rolled-back schema.
  await runCodegen();
}
