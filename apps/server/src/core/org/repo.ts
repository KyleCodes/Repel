import type { DbExecutor, OrgRow } from '../../db/types.ts';

export function makeOrgRepo(q: DbExecutor) {
  return {
    async insert(input: { name: string }): Promise<OrgRow> {
      return q
        .insertInto('org')
        .values({ name: input.name })
        .returningAll()
        .executeTakeFirstOrThrow();
    },

    async findById(id: string): Promise<OrgRow | undefined> {
      return q
        .selectFrom('org')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
    },

    async findByName(name: string): Promise<OrgRow | undefined> {
      return q
        .selectFrom('org')
        .selectAll()
        .where('name', '=', name)
        .executeTakeFirst();
    },
  };
}

export type OrgRepo = ReturnType<typeof makeOrgRepo>;
