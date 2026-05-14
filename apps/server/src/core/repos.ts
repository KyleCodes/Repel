import type { DbExecutor } from '../db/types.ts';
import { makeAcmeRepo } from './acme/repo.ts';
import { makeMigrationsRepo } from './migrations/repo.ts';
import { makeOrgRepo } from './org/repo.ts';
import { makeUserRepo } from './user/repo.ts';

// Bundles every bounded context's repo factory into one object keyed by name.
// A fresh Repos bundle is built for each transaction so every repo inside
// it is bound to the same DbExecutor (db or trx). Services take Repos as
// their single dependency — they never see raw Kysely.
//
// Adding a new vertical = add one line here.
export function makeRepos(q: DbExecutor) {
  return {
    orgs: makeOrgRepo(q),
    users: makeUserRepo(q),
    acme: makeAcmeRepo(q),
    migrations: makeMigrationsRepo(q),
  };
}

export type Repos = ReturnType<typeof makeRepos>;
