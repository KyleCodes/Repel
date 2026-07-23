import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { logger } from '@repel/logger/logger';
import { parseOrExit } from '../../lib/parse-or-exit';
import { extractTicketSlug, getCurrentBranch } from '../lib/branch';
import { runCodegen } from '../lib/codegen';
import { readDatabaseUrlFromEnvLocal } from '../lib/env-local';
import {
  applyHeaderToFile,
  findCreatedMigrationDir,
  formatHeader,
  resolveMigrationName,
} from '../lib/migrations';
import { runPrismaCli } from '../lib/prisma-cli';
import {
  type MigrateCreateInput,
  MigrateCreateInputSchema,
  type MigrateUpInput,
  MigrateUpInputSchema,
} from './schemas/index';

export function registerMigrationsCommands(db: Command): void {
  const migrate = db.command('migrations').description('Migration lifecycle');

  migrate
    .command('create [name]')
    .description(
      'Generate a new migration from the schema diff (prisma migrate dev --create-only) with a docstring header; review before applying'
    )
    .action(async function (name: string | undefined) {
      const input = parseOrExit(MigrateCreateInputSchema, { name });
      await runMigrateCreate(input);
    });

  migrate
    .command('up')
    .description('Apply all pending migrations (prisma migrate deploy)')
    .action(async function () {
      const input = parseOrExit(MigrateUpInputSchema, {});
      await runMigrateUp(input);
    });
}

export async function runMigrateCreate(
  input: MigrateCreateInput
): Promise<void> {
  const branch = getCurrentBranch();
  const name = resolveMigrationName({ explicit: input.name, branch });
  // --create-only writes the SQL without applying, which is the hand-review
  // seam for DDL the schema language cannot express (RLS, partial indexes,
  // CHECKs) and for auditing the differ's output before it touches the DB.
  // Requires shadow-database privileges; the dev `repel` role can CREATEDB,
  // so Prisma provisions a throwaway shadow DB itself.
  runPrismaCli(['migrate', 'dev', '--create-only', '--name', name], {
    databaseUrl: readDatabaseUrlFromEnvLocal(),
  });
  const dirPath = findCreatedMigrationDir(name);
  const filePath = dirPath ? join(dirPath, 'migration.sql') : null;
  if (!filePath || !existsSync(filePath)) {
    throw new Error(
      `db migrations create: could not locate generated migration for "${name}"`
    );
  }
  const header = formatHeader({
    name,
    branch,
    ticket: extractTicketSlug(branch),
    createdAt: new Date(),
  });
  applyHeaderToFile(filePath, header);
  logger.info('migrations create: wrote', { filePath });
  logger.info(
    'migrations create: review the SQL, then `repel db migrations up` to apply'
  );
}

export async function runMigrateUp(_input: MigrateUpInput): Promise<void> {
  runPrismaCli(['migrate', 'deploy'], {
    databaseUrl: readDatabaseUrlFromEnvLocal(),
  });
  // Regenerate the Prisma client so the committed types reflect schema.prisma.
  await runCodegen();
}
