import { runInTx } from '../../db/tx.ts';
import { pgMigrationsRowToAppliedMigration } from './mappers.ts';
import type { AppliedMigration } from './types.ts';

// `pgmigrations` is unscoped infrastructure metadata — no orgId, no RLS.
// Uses runInTx (not runInOrgTx) per ADR-010.
export const migrationsService = {
  listApplied: runInTx(async function (
    repos,
    _input: void
  ): Promise<AppliedMigration[]> {
    const rows = await repos.migrations.listApplied();
    return rows.map(pgMigrationsRowToAppliedMigration);
  }),
};
