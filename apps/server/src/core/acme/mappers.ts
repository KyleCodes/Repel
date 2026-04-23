import type { AcmeRow } from '../../db/types.js';
import type { Acme } from './types.js';

export function acmeRowToAcme(row: AcmeRow): Acme {
  return {
    id: row.id,
    orgId: row.orgId,
    note: row.note,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
