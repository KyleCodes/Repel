import type {
  ConnectedAccountRow,
  DbExecutor,
  NewConnectedAccount,
} from '../../db/types.js';

export function makeProviderRepo(q: DbExecutor) {
  return {
    async insert(data: NewConnectedAccount): Promise<ConnectedAccountRow> {
      return q
        .insertInto('connected_account')
        .values(data)
        .returningAll()
        .executeTakeFirstOrThrow();
    },

    async findById(id: string): Promise<ConnectedAccountRow | undefined> {
      return q
        .selectFrom('connected_account')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
    },

    async findByOrgId(orgId: string): Promise<ConnectedAccountRow[]> {
      return q
        .selectFrom('connected_account')
        .selectAll()
        .where('orgId', '=', orgId)
        .execute();
    },

    async findActiveByOrgId(orgId: string): Promise<ConnectedAccountRow[]> {
      return q
        .selectFrom('connected_account')
        .selectAll()
        .where('orgId', '=', orgId)
        .where('isActive', '=', true)
        .execute();
    },

    async updateSyncCursor(id: string, syncCursor: unknown): Promise<void> {
      await q
        .updateTable('connected_account')
        .set({
          syncCursor: JSON.stringify(syncCursor),
          lastSyncedAt: new Date(),
        })
        .where('id', '=', id)
        .execute();
    },

    async deactivate(id: string): Promise<void> {
      await q
        .updateTable('connected_account')
        .set({ isActive: false })
        .where('id', '=', id)
        .execute();
    },
  };
}

export type ProviderRepo = ReturnType<typeof makeProviderRepo>;
