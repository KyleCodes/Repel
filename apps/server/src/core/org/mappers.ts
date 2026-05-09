import type { OrgRow } from '../../db/types.ts';
import type { Org } from './types.ts';

export function orgRowToOrg(row: OrgRow): Org {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
