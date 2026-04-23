import type { UserRow } from '../../db/types.js';
import type { User } from './types.js';

export function userRowToUser(row: UserRow): User {
  return {
    id: row.id,
    orgId: row.orgId,
    email: row.email,
    name: row.name,
    role: row.role,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
