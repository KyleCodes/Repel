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

export interface NukeDatabaseInput {
  databaseUrl: string;
}

// Wipes a database back to empty: drops the `public` schema with everything in
// it (tables, enums, sequences, functions) — including Prisma Migrate's
// `_prisma_migrations` bookkeeping table — then recreates an empty `public`
// schema. The database itself is preserved; only its contents are reset. With
// `_prisma_migrations` gone, the next `migrations up` runs from zero.
//
// Unlike refresh-template this connects to the target database directly
// (DATABASE_URL), not the admin/maintenance database, because DROP SCHEMA
// operates inside the connected database.
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
// already live elsewhere (Prisma Migrate, account-setup bootstrap).
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
