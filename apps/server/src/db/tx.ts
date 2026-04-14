import { sql } from 'kysely';
import { getDb } from './runtime.js';
import { makeRepos, type Repos } from './repos.js';

// Opens a transaction, builds a Repos bundle over it, and runs fn(repos).
// Use for flows that don't have an org id yet — primarily bootstrap, which
// creates the org itself and relies on the migration role having BYPASSRLS.
export async function withTx<T>(fn: (repos: Repos) => Promise<T>): Promise<T> {
  return getDb()
    .transaction()
    .execute(function (trx) {
      return fn(makeRepos(trx));
    });
}

// Opens a transaction, sets app.current_org_id for RLS, builds a Repos bundle
// over the trx, and runs fn(repos). This is the default for every tenant-scoped
// flow. SET LOCAL scopes the session variable to the transaction, so it is
// automatically cleared on commit or rollback.
export async function withOrgTx<T>(
  orgId: string,
  fn: (repos: Repos) => Promise<T>
): Promise<T> {
  return getDb()
    .transaction()
    .execute(async function (trx) {
      await sql`SET LOCAL app.current_org_id = ${sql.lit(orgId)}`.execute(trx);
      return fn(makeRepos(trx));
    });
}
