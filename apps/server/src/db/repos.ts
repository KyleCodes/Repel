import type { DbExecutor } from './types.js';
import { makeOrgRepo } from '../domains/org/repo.js';
import { makeUserRepo } from '../domains/user/repo.js';
import { makeProviderRepo } from '../domains/providers/repo.js';

// Bundles every domain's repo factory into one object keyed by domain.
// A fresh Repos bundle is built for each transaction so every repo inside
// it is bound to the same DbExecutor (db or trx). Services take Repos as
// their single dependency — they never see raw Kysely.
export function makeRepos(q: DbExecutor) {
  return {
    orgs: makeOrgRepo(q),
    users: makeUserRepo(q),
    providers: makeProviderRepo(q),
  };
}

export type Repos = ReturnType<typeof makeRepos>;
