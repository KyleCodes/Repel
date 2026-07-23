import { DBError, normalizeDbError } from '../../error';
import { type Sql, sql } from '../../sql';
import type { Tx } from '../../types';

// SQLSTATE 42P01 = undefined_table. Prisma Migrate creates `_prisma_migrations`
// lazily on the first `migrate deploy`, so a fresh per-branch DB will throw
// here. We catch INSIDE the view so the surrounding transaction commits
// cleanly — if we let it bubble through the decorated service, the transaction
// would auto-rollback (harmless but noisy). The raw error is normalized first
// so the SQLSTATE check works regardless of how the driver adapter wraps it.

// Rows still mid-apply or rolled back are excluded — "applied" means finished.
export const buildListApplied = (): Sql => sql`
  SELECT migration_name AS "name", finished_at AS "runOn"
  FROM _prisma_migrations
  WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
  ORDER BY finished_at ASC`;

export type ListAppliedResultItem = { name: string; runOn: Date };

export async function listApplied(trx: Tx): Promise<ListAppliedResultItem[]> {
  try {
    return await trx.$queryRaw<ListAppliedResultItem[]>(buildListApplied());
  } catch (err) {
    const normalized = normalizeDbError(err);
    if (normalized instanceof DBError && normalized.code === '42P01') return [];
    throw err;
  }
}
