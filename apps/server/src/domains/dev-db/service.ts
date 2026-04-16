import { Client } from 'pg';

// Admin connection target. Points at the maintenance "postgres" database so
// CREATE/DROP DATABASE statements can run without holding a lock on the target.
// PG_ADMIN_URL overrides; otherwise derive from DATABASE_URL by swapping the
// db path for "postgres".
function adminUrl(): string {
  const explicit = process.env.PG_ADMIN_URL;
  if (explicit) return explicit;

  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('PG_ADMIN_URL or DATABASE_URL is required');

  const u = new URL(base);
  u.pathname = '/postgres';
  return u.toString();
}

// Derives a per-worktree database URL by swapping the path on the admin URL.
function databaseUrlFor(dbName: string): string {
  const u = new URL(adminUrl());
  u.pathname = `/${dbName}`;
  return u.toString();
}

// Sanitizes a branch name into a valid Postgres identifier.
// Lowercases, replaces runs of non-alphanumerics with a single underscore,
// trims leading/trailing underscores, prefixes with "repel_".
export function sanitizeBranchToDbName(branch: string): string {
  const slug = branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!slug) throw new Error(`branch "${branch}" produced an empty database slug`);
  return `repel_${slug}`;
}

async function withAdmin<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: adminUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function dbExists(client: Client, dbName: string): Promise<boolean> {
  const result = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  return result.rowCount === 1;
}

// Quotes a Postgres identifier by doubling any embedded double-quotes.
// Defense in depth: branch names are already sanitized, but DDL identifiers
// must still be quoted to be safe against edge cases.
function ident(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export interface CloneDatabaseInput {
  branch: string;
  template: string;
  force: boolean;
}

export interface CloneDatabaseResult {
  dbName: string;
  databaseUrl: string;
}

export async function cloneDatabase(input: CloneDatabaseInput): Promise<CloneDatabaseResult> {
  const dbName = sanitizeBranchToDbName(input.branch);

  await withAdmin(async function (client) {
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
    await client.query(`CREATE DATABASE ${ident(dbName)} TEMPLATE ${ident(input.template)}`);
  });

  return { dbName, databaseUrl: databaseUrlFor(dbName) };
}

export interface DropDatabaseInput {
  branch: string;
}

export async function dropDatabase(input: DropDatabaseInput): Promise<{ dbName: string; dropped: boolean }> {
  const dbName = sanitizeBranchToDbName(input.branch);

  return withAdmin(async function (client) {
    const exists = await dbExists(client, dbName);
    if (!exists) return { dbName, dropped: false };
    await client.query(`DROP DATABASE ${ident(dbName)} WITH (FORCE)`);
    return { dbName, dropped: true };
  });
}

export interface RefreshTemplateInput {
  template: string;
}

// Drops the template database and recreates it empty. The caller is responsible
// for running migrations and any bootstrap seeding afterwards — those flows
// already live elsewhere (node-pg-migrate, account-setup bootstrap).
export async function refreshTemplate(input: RefreshTemplateInput): Promise<{ databaseUrl: string }> {
  await withAdmin(async function (client) {
    const exists = await dbExists(client, input.template);
    if (exists) {
      await client.query(`DROP DATABASE ${ident(input.template)} WITH (FORCE)`);
    }
    await client.query(`CREATE DATABASE ${ident(input.template)}`);
  });

  return { databaseUrl: databaseUrlFor(input.template) };
}
