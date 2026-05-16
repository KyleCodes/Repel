import type { InferResult } from 'kysely';
import type { Tx } from '../../types.ts';

// SQLSTATE 42P01 = undefined_table. node-pg-migrate creates `pgmigrations`
// lazily on its first `up`, so a fresh per-branch DB will throw here. We
// catch INSIDE the view so the surrounding transaction commits cleanly —
// if we let it bubble through the decorated service, Kysely's transaction
// would auto-rollback (harmless but noisy).

const buildListApplied = (trx: Tx) =>
  trx
    .selectFrom('pgmigrations')
    .select(['name', 'runOn'])
    .orderBy('runOn', 'asc');

export type ListAppliedResultItem = InferResult<
  ReturnType<typeof buildListApplied>
>[number];

export async function listApplied(trx: Tx): Promise<ListAppliedResultItem[]> {
  try {
    return await buildListApplied(trx).execute();
  } catch (err) {
    if ((err as { code?: string } | null)?.code === '42P01') return [];
    throw err;
  }
}
