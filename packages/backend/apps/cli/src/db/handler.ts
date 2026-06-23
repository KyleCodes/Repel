import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Command } from 'commander';
import {
  cloneDatabase,
  dropDatabase,
  nukeDatabase,
  refreshTemplate,
} from '@repel/backend-db/admin-ops';
import { resolveAdminUrl } from '@repel/backend-db/lib/admin-url';
import { migrationsService } from '@repel/backend-db/migrations-tracking/service';
import { getOptionalEnvVar } from '@repel/backend-env/accessors';
import { confirm } from '../lib/confirm';
import { parseOrExit } from '../lib/parse-or-exit';
import { registerEncryptionCommands } from './encryption/handler';
import { runCodegen } from './lib/codegen';
import { runConnect } from './lib/connect';
import { readDatabaseUrlFromEnvLocal } from './lib/env-local';
import {
  listFsMigrations,
  partitionStatus,
  renderStatusTable,
} from './lib/migrations';
import { runQuery } from './lib/query';
import { registerMigrationsCommands } from './migrations/handler';
import {
  type CloneInput,
  CloneInputSchema,
  type CodegenInput,
  CodegenInputSchema,
  ConnectInputSchema,
  type DropInput,
  DropInputSchema,
  type NukeInput,
  NukeInputSchema,
  type QueryInput,
  QueryInputSchema,
  type RefreshTemplateInput,
  RefreshTemplateInputSchema,
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

  console.log(`db clone: created ${dbName} from ${input.template}`);
  console.log(`db clone: wrote ${envPath}`);
}

export async function runDrop(input: DropInput): Promise<void> {
  const adminUrl = readAdminUrlFromEnv();
  const { dbName, dropped } = await dropDatabase({
    adminUrl,
    branch: input.branch,
  });
  if (dropped) {
    console.log(`db drop: dropped ${dbName}`);
  } else {
    console.log(`db drop: ${dbName} did not exist`);
  }
}

export async function runRefreshTemplate(
  input: RefreshTemplateInput
): Promise<void> {
  const adminUrl = readAdminUrlFromEnv();
  await refreshTemplate({ adminUrl, template: input.template });
  console.log(`db refresh-template: recreated ${input.template} (empty)`);
  console.log(
    `db refresh-template: next steps — run migrations and bootstrap against ${input.template}`
  );
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
      console.log('db nuke: cancelled');
      return;
    }
  }
  const databaseUrl = readDatabaseUrlFromEnvLocal();
  await nukeDatabase({ databaseUrl });
  console.log(
    'db nuke: dropped and recreated the public schema — run `repel db migrations up` to re-apply migrations from zero'
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
