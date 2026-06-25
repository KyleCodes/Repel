import type { Command } from 'commander';
import { nukeDatabase, refreshTemplate } from '@repel/backend-db/admin-ops';
import { resolveAdminUrl } from '@repel/backend-db/lib/admin-url';
import { migrationsService } from '@repel/backend-db/migrations-tracking/service';
import { getOptionalEnvVar } from '@repel/backend-env/accessors';
import { logger } from '@repel/logger/logger';
import { confirm } from '../lib/confirm';
import { parseOrExit } from '../lib/parse-or-exit';
import { registerEncryptionCommands } from './encryption/handler';
import { runCodegen } from './lib/codegen';
import { runConnect } from './lib/connect';
import { runDump, runRestore } from './lib/dump-restore';
import { readDatabaseUrlFromEnvLocal } from './lib/env-local';
import {
  listFsMigrations,
  partitionStatus,
  renderStatusTable,
} from './lib/migrations';
import { runQuery } from './lib/query';
import { registerMigrationsCommands } from './migrations/handler';
import {
  type CodegenInput,
  CodegenInputSchema,
  ConnectInputSchema,
  type DumpInput,
  DumpInputSchema,
  type NukeInput,
  NukeInputSchema,
  type QueryInput,
  QueryInputSchema,
  type RefreshTemplateInput,
  RefreshTemplateInputSchema,
  type RestoreInput,
  RestoreInputSchema,
  type StatusInput,
  StatusInputSchema,
} from './schemas/index';

function readAdminUrlFromEnv(): string {
  return resolveAdminUrl({
    pgAdminUrl: getOptionalEnvVar('PG_ADMIN_URL'),
    databaseUrl: getOptionalEnvVar('DATABASE_URL'),
  });
}

export function registerDbCommands(program: Command): void {
  const db = program
    .command('db')
    .description('Local development database lifecycle');

  db.command('dump')
    .description(
      "Dump this stack's database to a seed archive via the postgres container (run from the source worktree)"
    )
    .requiredOption('--out <file>', 'archive file to write')
    .option('--database <name>', 'database to dump (default: repel)')
    .action(async function (opts: { out: string; database?: string }) {
      const input = parseOrExit(DumpInputSchema, {
        out: opts.out,
        database: opts.database,
      });
      await runDumpCommand(input);
    });

  db.command('restore')
    .description(
      "Restore a seed archive into this stack's database via the postgres container (manual re-seed)"
    )
    .requiredOption('--from-file <file>', 'archive file to restore')
    .option('--database <name>', 'database to restore into (default: repel)')
    .action(async function (opts: { fromFile: string; database?: string }) {
      const input = parseOrExit(RestoreInputSchema, {
        fromFile: opts.fromFile,
        database: opts.database,
      });
      await runRestoreCommand(input);
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

  registerMigrationsCommands(db);
  registerEncryptionCommands(db);

  db.command('status')
    .description(
      'Diff applied migrations in pgmigrations against the filesystem'
    )
    .action(async function () {
      const input = parseOrExit(StatusInputSchema, {});
      await runStatus(input);
    });

  db.command('nuke')
    .description(
      'Reset the per-branch database to empty (drops the public schema, including pgmigrations) so migrations re-apply from zero'
    )
    .option('-y, --yes', 'skip the confirmation prompt')
    .action(async function (opts: { yes?: boolean }) {
      const input = parseOrExit(NukeInputSchema, { yes: opts.yes });
      await runNuke(input);
    });

  db.command('codegen')
    .description(
      'Regenerate infra/db/generated.ts from the live database schema'
    )
    .action(async function () {
      const input = parseOrExit(CodegenInputSchema, {});
      await runCodegenCommand(input);
    });

  db.command('connect')
    .description('Open an interactive pgcli session against the worktree DB')
    .action(function () {
      parseOrExit(ConnectInputSchema, {});
      runConnect();
    });

  db.command('query <sql>')
    .description(
      'Run SQL against the worktree DB and print JSON rows to stdout (pass `-` to read SQL from stdin)'
    )
    .action(async function (sql: string) {
      const input = parseOrExit(QueryInputSchema, { sql });
      await runQuery(input);
    });
}

// The compose stack always names its service `postgres` and its DB user `repel`
// (docker-compose.yml). dump/restore exec inside that container, so they need no
// host postgres tooling and no DATABASE_URL — just the compose project resolved
// from the cwd (the worktree the command is run in).
const PG_SERVICE = 'postgres';
const PG_USER = 'repel';

export async function runDumpCommand(input: DumpInput): Promise<void> {
  runDump({
    service: PG_SERVICE,
    user: PG_USER,
    database: input.database,
    outFile: input.out,
  });
  logger.info('dump: wrote', { out: input.out });
}

export async function runRestoreCommand(input: RestoreInput): Promise<void> {
  runRestore({
    service: PG_SERVICE,
    user: PG_USER,
    database: input.database,
    inFile: input.fromFile,
  });
  logger.info('restore: restored', { fromFile: input.fromFile });
}

export async function runRefreshTemplate(
  input: RefreshTemplateInput
): Promise<void> {
  const adminUrl = readAdminUrlFromEnv();
  await refreshTemplate({ adminUrl, template: input.template });
  logger.info('refresh-template: recreated (empty)', {
    template: input.template,
  });
  logger.info('refresh-template: next steps — run migrations and bootstrap', {
    template: input.template,
  });
}

export async function runNuke(
  input: NukeInput,
  stdin: NodeJS.ReadableStream = process.stdin
): Promise<void> {
  if (!input.yes) {
    // Destructive: drops the public schema. Prompt unless --yes was passed.
    // A declined prompt (or non-TTY stdin) leaves the database untouched.
    // `stdin` is injectable so tests can drive the prompt without a real TTY.
    const ok = await confirm(
      'db nuke: drop and recreate the public schema? [y/N] ',
      stdin
    );
    if (!ok) {
      logger.info('nuke: cancelled');
      return;
    }
  }
  const databaseUrl = readDatabaseUrlFromEnvLocal();
  await nukeDatabase({ databaseUrl });
  logger.info(
    'nuke: dropped and recreated the public schema — run `repel db migrations up` to re-apply migrations from zero'
  );
  // Regenerate types to reflect the now-empty schema.
  await runCodegen();
}

export async function runCodegenCommand(_input: CodegenInput): Promise<void> {
  await runCodegen();
}

export async function runStatus(_input: StatusInput): Promise<void> {
  const applied = await migrationsService.listApplied();
  const fs = listFsMigrations();
  logger.output(
    renderStatusTable(
      partitionStatus({
        fs,
        applied: applied.map(function (a) {
          return a.name;
        }),
      })
    ) + '\n'
  );
}
