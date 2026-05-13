import type { DbExecutor, PgMigrationsRow } from '../../db/types.ts';

// SQLSTATE 42P01 = undefined_table. node-pg-migrate creates `pgmigrations`
// lazily on its first `up`, so a fresh per-branch DB will throw here. We
// catch INSIDE the repo so the surrounding runInTx commits cleanly — if we
// let it bubble through the decorated service, Kysely's transaction would
// auto-rollback (harmless but noisy).
export function makeMigrationsRepo(q: DbExecutor) {
  return {
    async listApplied(): Promise<PgMigrationsRow[]> {
      try {
        return await q
          .selectFrom('pgmigrations')
          .selectAll()
          .orderBy('runOn', 'asc')
          .execute();
      } catch (err) {
        if ((err as { code?: string } | null)?.code === '42P01') return [];
        throw err;
      }
    },
  };
}

export type MigrationsRepo = ReturnType<typeof makeMigrationsRepo>;
