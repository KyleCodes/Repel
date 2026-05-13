import { Client } from 'pg';
import { buildDatabaseUrl } from './lib/admin-url.ts';

// Sanitizes a branch name into a valid Postgres identifier.
// Lowercases, replaces runs of non-alphanumerics with a single underscore,
// trims leading/trailing underscores, prefixes with "repel_".
export function sanitizeBranchToDbName(branch: string): string {
  const slug = branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!slug)
    throw new Error(`branch "${branch}" produced an empty database slug`);
  return `repel_${slug}`;
}

async function withAdmin<T>(
  adminUrl: string,
  fn: (c: Client) => Promise<T>
): Promise<T> {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function dbExists(client: Client, dbName: string): Promise<boolean> {
  const result = await client.query(
    'SELECT 1 FROM pg_database WHERE datname = $1',
    [dbName]
  );
  return result.rowCount === 1;
}

// Quotes a Postgres identifier by doubling any embedded double-quotes.
// Defense in depth: branch names are already sanitized, but DDL identifiers
// must still be quoted to be safe against edge cases.
function ident(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export interface CloneDatabaseInput {
  adminUrl: string;
  branch: string;
  template: string;
  force: boolean;
}

export interface CloneDatabaseResult {
  dbName: string;
  databaseUrl: string;
}

export async function cloneDatabase(
  input: CloneDatabaseInput
): Promise<CloneDatabaseResult> {
  const dbName = sanitizeBranchToDbName(input.branch);

  await withAdmin(input.adminUrl, async function (client) {
    const exists = await dbExists(client, dbName);
    if (exists) {
      if (!input.force) {
        throw new Error(
          `database ${dbName} already exists — pass --force to replace it`
        );
      }
      await client.query(`DROP DATABASE ${ident(dbName)} WITH (FORCE)`);
    }

    // CREATE DATABASE cannot run inside a transaction block, and pg's default
    // auto-commit mode handles that for us. TEMPLATE copies schema + data.
    await client.query(
      `CREATE DATABASE ${ident(dbName)} TEMPLATE ${ident(input.template)}`
    );
  });

  return { dbName, databaseUrl: buildDatabaseUrl(input.adminUrl, dbName) };
}

export interface DropDatabaseInput {
  adminUrl: string;
  branch: string;
}

export async function dropDatabase(
  input: DropDatabaseInput
): Promise<{ dbName: string; dropped: boolean }> {
  const dbName = sanitizeBranchToDbName(input.branch);

  return withAdmin(input.adminUrl, async function (client) {
    const exists = await dbExists(client, dbName);
    if (!exists) return { dbName, dropped: false };
    await client.query(`DROP DATABASE ${ident(dbName)} WITH (FORCE)`);
    return { dbName, dropped: true };
  });
}

// Reads applied migration names from the `pgmigrations` table on the current
// per-branch DB. SQLSTATE 42P01 (undefined_table) is treated as "no rows"
// because a freshly cloned DB hasn't been migrated yet and the table is
// created lazily by node-pg-migrate's first `up`.
//
// Lives here temporarily — see D2 in the REP-39 follow-up plan. Long-term
// home is `core/migrations/{repo,service}.ts` under ADR-009/010.
export async function listAppliedMigrations(
  databaseUrl: string
): Promise<string[]> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query<{ name: string }>(
      'SELECT name FROM pgmigrations ORDER BY run_on'
    );
    return result.rows.map(function (r) {
      return r.name;
    });
  } catch (err) {
    if ((err as { code?: string } | null)?.code === '42P01') return [];
    throw err;
  } finally {
    await client.end();
  }
}

export interface RefreshTemplateInput {
  adminUrl: string;
  template: string;
}

// Drops the template database and recreates it empty. The caller is responsible
// for running migrations and any bootstrap seeding afterwards — those flows
// already live elsewhere (node-pg-migrate, account-setup bootstrap).
export async function refreshTemplate(
  input: RefreshTemplateInput
): Promise<{ databaseUrl: string }> {
  await withAdmin(input.adminUrl, async function (client) {
    const exists = await dbExists(client, input.template);
    if (exists) {
      await client.query(`DROP DATABASE ${ident(input.template)} WITH (FORCE)`);
    }
    await client.query(`CREATE DATABASE ${ident(input.template)}`);
  });

  return { databaseUrl: buildDatabaseUrl(input.adminUrl, input.template) };
}
