import type { PgMigrationsRow } from '../../db/types.ts';
import type { AppliedMigration } from './types.ts';

export function pgMigrationsRowToAppliedMigration(
  row: PgMigrationsRow
): AppliedMigration {
  return { name: row.name, runOn: row.runOn };
}
