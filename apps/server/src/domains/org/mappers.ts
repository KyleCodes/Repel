import type { OrgRow } from '../../db/types.js';
import type { Org } from './types.js';

export function orgRowToOrg(row: OrgRow): Org {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
