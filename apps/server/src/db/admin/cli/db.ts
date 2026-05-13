import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Command } from 'commander';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import runner from 'node-pg-migrate';
import type { z } from 'zod';
import { getDb } from '../../runtime.ts';
import type { DB } from '../../types.ts';
import { resolveAdminUrl } from '../lib/admin-url.ts';
import {
  cloneDatabase,
  dropDatabase,
  refreshTemplate,
  sanitizeBranchToDbName,
} from '../service.ts';
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
  CloneInput,
  DropInput,
  MigrateCreateInput,
  MigrateDownInput,
  MigrateUpInput,
  RefreshTemplateInput,
  StatusInput,
} from './schemas/db.ts';

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

  const migrate = db.command('migrate').description('Migration lifecycle');

  migrate
    .command('create [name]')
    .description('Generate a new migration file with a docstring header')
    .action(async function (name: string | undefined) {
      const input = parseOrExit(MigrateCreateInput, { name });
      await runMigrateCreate(input);
    });

  migrate
    .command('up [target]')
    .description('Apply pending migrations')
    .action(async function (target: string | undefined) {
      const input = parseOrExit(MigrateUpInput, { target });
      await runMigrateUp(input);
    });

  migrate
    .command('down [target]')
    .description('Roll back applied migrations')
    .action(async function (target: string | undefined) {
      const input = parseOrExit(MigrateDownInput, { target });
      await runMigrateDown(input);
    });

  db.command('status')
    .description(
      'Diff applied migrations in pgmigrations against the filesystem'
    )
    .action(async function () {
      const input = parseOrExit(StatusInput, {});
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

export interface RunMigrateCreateDeps {
  getBranch?: () => string;
  exec?: (name: string) => string;
  now?: () => Date;
  applyHeader?: (filePath: string, header: string) => void;
}

export async function runMigrateCreate(
  input: MigrateCreateInput,
  deps: RunMigrateCreateDeps = {}
): Promise<void> {
  const getBranch = deps.getBranch ?? getCurrentBranch;
  const exec = deps.exec ?? defaultExec;
  const now =
    deps.now ??
    function () {
      return new Date();
    };
  const apply = deps.applyHeader ?? applyHeaderToFile;

  const branch = getBranch();
  const name = resolveMigrationName({ explicit: input.name, branch });
  const stdout = exec(name);
  let filePath = parseGeneratedPath(stdout);
  if (!filePath || !existsSync(filePath)) {
    filePath = findNewestMigrationFile(MIGRATIONS_DIR);
  }
  const ticket = extractTicketSlug(branch);
  const header = formatHeader({
    name,
    branch,
    ticket,
    createdAt: now(),
  });
  apply(filePath, header);
  console.error(`db migrate create: wrote ${filePath}`);
}

function defaultExec(name: string): string {
  return execFileSync(
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
}

// Fallback when stdout parsing misses. Picks the most-recently-modified
// migration file in MIGRATIONS_DIR matching the canonical filename shape.
export function findNewestMigrationFile(dir: string): string {
  const candidates = readdirSync(dir)
    .filter(function (n) {
      return /^\d+_.*\.ts$/.test(n) && !n.endsWith('.d.ts');
    })
    .map(function (n) {
      const full = join(dir, n);
      return { full, mtime: statSync(full).mtimeMs };
    })
    .sort(function (a, b) {
      return b.mtime - a.mtime;
    });
  if (candidates.length === 0) {
    throw new Error(
      `db migrate create: no migration file found in ${dir} after node-pg-migrate create`
    );
  }
  return candidates[0].full;
}

export interface RunMigrateDeps {
  runRunner?: (opts: ReturnType<typeof buildRunnerOptions>) => Promise<unknown>;
  readUrl?: () => string;
}

export async function runMigrateUp(
  input: MigrateUpInput,
  deps: RunMigrateDeps = {}
): Promise<void> {
  const run = deps.runRunner ?? runner;
  const readUrl = deps.readUrl ?? readDatabaseUrlFromEnvLocal;
  await run(buildRunnerOptions('up', input.target, { databaseUrl: readUrl() }));
}

export async function runMigrateDown(
  input: MigrateDownInput,
  deps: RunMigrateDeps = {}
): Promise<void> {
  const run = deps.runRunner ?? runner;
  const readUrl = deps.readUrl ?? readDatabaseUrlFromEnvLocal;
  await run(
    buildRunnerOptions('down', input.target, { databaseUrl: readUrl() })
  );
}

// Reads names of applied migrations from the pgmigrations table. Extracted
// from runStatus so the SQL side can be dep-injected in tests without faking
// the full Kysely executor pipeline (a stub `db` cannot survive sql.execute's
// compile + transformQuery chain). Production code still goes through Kysely.
export async function fetchAppliedMigrations(
  db: Kysely<DB>
): Promise<string[]> {
  const result = await sql<{
    name: string;
  }>`SELECT name FROM pgmigrations ORDER BY run_on`.execute(db);
  return result.rows.map(function (r) {
    return r.name;
  });
}

export interface RunStatusDeps {
  db?: Kysely<DB>;
  listFs?: () => string[];
  fetchApplied?: (db: Kysely<DB>) => Promise<string[]>;
}

export async function runStatus(
  _input: StatusInput,
  deps: RunStatusDeps = {}
): Promise<void> {
  const db = deps.db ?? getDb();
  const listFs = deps.listFs ?? listFsMigrations;
  const fetchApplied = deps.fetchApplied ?? fetchAppliedMigrations;
  let applied: string[] = [];
  try {
    applied = await fetchApplied(db);
  } catch (e) {
    if ((e as { code?: string } | null)?.code === '42P01') {
      applied = [];
    } else {
      throw e;
    }
  }
  console.log(renderStatusTable(partitionStatus({ fs: listFs(), applied })));
}

export { sanitizeBranchToDbName };
