import type { Repos } from '../../db/repos.js';
import { userRowToUser } from './mappers.js';
import type { CreateUserInput, User } from './types.js';

export function makeUserService(repos: Repos) {
  return {
    async createUser(input: CreateUserInput): Promise<User> {
      const existing = await repos.users.findByEmail(input.email);
      if (existing) throw new Error(`User with email "${input.email}" already exists`);

      const row = await repos.users.insert({
        orgId: input.orgId,
        email: input.email,
        name: input.name ?? null,
        role: input.role ?? 'admin',
      });
      return userRowToUser(row);
    },

    async getUser(id: string): Promise<User> {
      const row = await repos.users.findById(id);
      if (!row) throw new Error(`User ${id} not found`);
      return userRowToUser(row);
    },

    async listUsers(orgId: string): Promise<User[]> {
      const rows = await repos.users.findByOrgId(orgId);
      return rows.map(userRowToUser);
    },
  };
}

export type UserService = ReturnType<typeof makeUserService>;
