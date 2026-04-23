import type { DbExecutor, NewUser, UserRow } from '../../db/types.js';

export function makeUserRepo(q: DbExecutor) {
  return {
    async insert(data: NewUser): Promise<UserRow> {
      return q
        .insertInto('user')
        .values(data)
        .returningAll()
        .executeTakeFirstOrThrow();
    },

    async findById(id: string): Promise<UserRow | undefined> {
      return q
        .selectFrom('user')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
    },

    async findByEmail(email: string): Promise<UserRow | undefined> {
      return q
        .selectFrom('user')
        .selectAll()
        .where('email', '=', email)
        .executeTakeFirst();
    },

    async findByOrgId(orgId: string): Promise<UserRow[]> {
      return q
        .selectFrom('user')
        .selectAll()
        .where('orgId', '=', orgId)
        .execute();
    },
  };
}

export type UserRepo = ReturnType<typeof makeUserRepo>;
