// Reference vertical — demonstrates the canonical shape of a tenant-scoped
// bounded context. Has no dependents. Delete when a new vertical in this repo
// is well-exercised as the reference.

import { runInOrgTx } from '../../db/tx.js';
import { acmeRowToAcme } from './mappers.js';
import type { Acme, CreateAcmeInput, ListAcmeOptions } from './types.js';

export const acmeService = {
  createAcme: runInOrgTx(async function (repos, input: CreateAcmeInput): Promise<Acme> {
    const row = await repos.acme.insert({
      orgId: input.orgId,
      note: input.note,
    });
    return acmeRowToAcme(row);
  }),

  getAcmeById: runInOrgTx(async function (
    repos,
    input: { orgId: string; id: string },
  ): Promise<Acme> {
    const row = await repos.acme.findById(input.id);
    if (!row) throw new Error(`Acme ${input.id} not found`);
    return acmeRowToAcme(row);
  }),

  listAcmeForOrg: runInOrgTx(async function (
    repos,
    input: { orgId: string } & ListAcmeOptions,
  ): Promise<Acme[]> {
    const rows = await repos.acme.listForOrg(input.orgId, { limit: input.limit });
    return rows.map(acmeRowToAcme);
  }),

  deleteAcme: runInOrgTx(async function (
    repos,
    input: { orgId: string; id: string },
  ): Promise<void> {
    await repos.acme.deleteById(input.id);
  }),
};
