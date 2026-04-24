// Resolves the admin connection URL from env inputs. Admin URL points at the
// maintenance "postgres" database so CREATE/DROP DATABASE can run without
// holding a lock on the target. PG_ADMIN_URL takes precedence; otherwise
// derive from DATABASE_URL by swapping the db path for "postgres".
export function resolveAdminUrl(env: { pgAdminUrl?: string; databaseUrl?: string }): string {
  if (env.pgAdminUrl) return env.pgAdminUrl;
  if (!env.databaseUrl) throw new Error('PG_ADMIN_URL or DATABASE_URL is required');

  const u = new URL(env.databaseUrl);
  u.pathname = '/postgres';
  return u.toString();
}

// Builds a per-database connection URL from the admin URL template by swapping
// the db path segment. Used to produce the DATABASE_URL that gets written into
// a worktree's .env.local after a clone.
export function buildDatabaseUrl(adminUrl: string, dbName: string): string {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
}
