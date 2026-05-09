import type { Repos } from '../../db/repos.ts';
import { runInTx } from '../../db/tx.ts';
import { orgServiceImpl } from '../org/service.ts';
import { userServiceImpl } from '../user/service.ts';
import type { BootstrapInput, BootstrapResult } from './types.ts';

// Cross-cutting bootstrap flow. Creates the first org and user atomically.
// Runs under runInTx because the org does not exist yet — RLS is bypassed
// by running under the migration/superuser role.
//
// Uses the undecorated *Impl functions rather than the decorated services
// because tenant-scoped decorators refuse to join a runInTx ambient (RLS
// is not active). The Impl functions take `repos` directly and inherit the
// current transaction through argument-passing.
async function bootstrapImpl(
  repos: Repos,
  input: BootstrapInput
): Promise<BootstrapResult> {
  const existing = await repos.users.findByEmail(input.userEmail);
  if (existing) {
    throw new Error(
      `already bootstrapped — user ${input.userEmail} exists in org ${existing.orgId}`
    );
  }

  const org = await orgServiceImpl.createOrg(repos, { name: input.orgName });
  const user = await userServiceImpl.createUser(repos, {
    orgId: org.id,
    email: input.userEmail,
    name: input.userName,
    role: 'admin',
  });

  return { org, user };
}

export const accountSetupService = {
  bootstrap: runInTx(bootstrapImpl),
};

export const accountSetupServiceImpl = {
  bootstrap: bootstrapImpl,
};
