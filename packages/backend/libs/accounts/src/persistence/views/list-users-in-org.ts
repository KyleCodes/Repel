import type { User } from '@repel/backend-db/prisma/client';
import type { Tx } from '@repel/backend-db/types';

// No input — the caller's tenant scope (via runInOrgTx) determines which
// org's users to list. Postgres RLS filters by current_org_id, so a bare
// findMany() returns only the current tenant's rows.

export type ListUsersInOrgResultItem = User;

export async function listUsersInOrg(
  trx: Tx
): Promise<ListUsersInOrgResultItem[]> {
  return trx.user.findMany();
}
