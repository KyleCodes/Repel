import type { Repos } from '../../db/repos.ts';
import { runInOrgTx, runInTx } from '../../db/tx.ts';
import { orgRowToOrg } from './mappers.ts';
import type { CreateOrgInput, Org } from './types.ts';

// createOrg is lifted to a named impl because accountSetupService composes
// it inside runInTx (the decorated tenant-scoped services refuse to join an
// unscoped ambient tx — see ADR-009).
async function createOrgImpl(
  repos: Repos,
  input: CreateOrgInput
): Promise<Org> {
  const existing = await repos.orgs.findByName(input.name);
  if (existing) throw new Error(`Org with name "${input.name}" already exists`);
  const row = await repos.orgs.insert({ name: input.name });
  return orgRowToOrg(row);
}

export const orgService = {
  createOrg: runInTx(createOrgImpl),

  getOrgById: runInOrgTx(async function (
    repos,
    input: { orgId: string }
  ): Promise<Org> {
    const row = await repos.orgs.findById(input.orgId);
    if (!row) throw new Error(`Org ${input.orgId} not found`);
    return orgRowToOrg(row);
  }),
};

export const orgServiceImpl = {
  createOrg: createOrgImpl,
};
