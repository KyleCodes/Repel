import type { Repos } from '../../db/repos.ts';
import { runInOrgTx, runInTx } from '../../db/tx.ts';
import { userRowToUser } from './mappers.ts';
import type { CreateUserInput, User } from './types.ts';

// createUser is lifted to a named impl because accountSetupService composes
// it inside runInTx (see ADR-009).
async function createUserImpl(
  repos: Repos,
  input: CreateUserInput
): Promise<User> {
  const row = await repos.users.insert({
    orgId: input.orgId,
    email: input.email,
    name: input.name ?? null,
    role: input.role ?? 'admin',
  });
  return userRowToUser(row);
}

export const userService = {
  createUser: runInTx(createUserImpl),

  getUserById: runInOrgTx(async function (
    repos,
    input: { orgId: string; id: string }
  ): Promise<User> {
    const row = await repos.users.findById(input.id);
    if (!row) throw new Error(`User ${input.id} not found`);
    return userRowToUser(row);
  }),

  listUsersInOrg: runInOrgTx(async function (
    repos,
    input: { orgId: string }
  ): Promise<User[]> {
    const rows = await repos.users.findByOrgId(input.orgId);
    return rows.map(userRowToUser);
  }),
};

export const userServiceImpl = {
  createUser: createUserImpl,
};
