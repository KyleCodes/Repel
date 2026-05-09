import { makeAcmeRepo } from '../core/acme/repo.ts';
import { makeOrgRepo } from '../core/org/repo.ts';
import { makeUserRepo } from '../core/user/repo.ts';
import type { DbExecutor } from './types.ts';

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
  };
}

export type Repos = ReturnType<typeof makeRepos>;
