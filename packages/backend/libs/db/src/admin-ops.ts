import { Client } from 'pg';
import { sanitizeSlug } from '@repel/slug';
import { buildDatabaseUrl } from './lib/admin-url';

// Sanitizes a branch name into a valid Postgres database name. Returns
// "repel_<slug>" where <slug> is produced by the shared sanitizer
// (lowercase, runs of non-[a-z0-9_-] collapsed to `_`, trim `_`).
// The resulting name may contain `-` and `_` — that's fine because every
// callsite double-quotes via `ident()`.
export function sanitizeBranchToDbName(branch: string): string {
  const slug = sanitizeSlug(branch);
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

export interface NukeDatabaseInput {
  databaseUrl: string;
}

// Wipes a database back to empty: drops the `public` schema with everything in
// it (tables, enums, sequences, functions) — including node-pg-migrate's
// `pgmigrations` bookkeeping table — then recreates an empty `public` schema.
// The database itself is preserved; only its contents are reset. With
// `pgmigrations` gone, the next `migrations up` runs from zero.
//
// Unlike clone/drop/refresh-template this connects to the target database
// directly (DATABASE_URL), not the admin/maintenance database, because
// DROP SCHEMA operates inside the connected database.
export async function nukeDatabase(input: NukeDatabaseInput): Promise<void> {
  const client = new Client({ connectionString: input.databaseUrl });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
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
