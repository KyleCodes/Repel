import type { Repos } from '../../db/repos.js';
import { orgRowToOrg } from './mappers.js';
import type { CreateOrgInput, Org } from './types.js';

export function makeOrgService(repos: Repos) {
  return {
    async createOrg(input: CreateOrgInput): Promise<Org> {
      const existing = await repos.orgs.findByName(input.name);
      if (existing) throw new Error(`Org with name "${input.name}" already exists`);
      const row = await repos.orgs.insert({ name: input.name });
      return orgRowToOrg(row);
    },

    async getOrg(id: string): Promise<Org> {
      const row = await repos.orgs.findById(id);
      if (!row) throw new Error(`Org ${id} not found`);
      return orgRowToOrg(row);
    },
  };
}

export type OrgService = ReturnType<typeof makeOrgService>;
