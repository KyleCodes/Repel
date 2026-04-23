import type { AcmeRow, DbExecutor, NewAcme } from '../../db/types.js';

export function makeAcmeRepo(q: DbExecutor) {
  return {
    async insert(data: NewAcme): Promise<AcmeRow> {
      return q
        .insertInto('acme')
        .values(data)
        .returningAll()
        .executeTakeFirstOrThrow();
    },

    async findById(id: string): Promise<AcmeRow | undefined> {
      return q
        .selectFrom('acme')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
    },

    async listForOrg(orgId: string, opts: { limit?: number } = {}): Promise<AcmeRow[]> {
      let query = q
        .selectFrom('acme')
        .selectAll()
        .where('orgId', '=', orgId)
        .orderBy('createdAt', 'desc');
      if (opts.limit !== undefined) query = query.limit(opts.limit);
      return query.execute();
    },

    async deleteById(id: string): Promise<void> {
      await q.deleteFrom('acme').where('id', '=', id).execute();
    },
  };
}

export type AcmeRepo = ReturnType<typeof makeAcmeRepo>;
