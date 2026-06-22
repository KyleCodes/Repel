import type { InferResult } from 'kysely';
import type { Tx } from '@repel/backend-db/types';

// No input — the caller's tenant scope (via runInOrgTx) determines which
// org's users to list. Postgres RLS filters by current_org_id, so a bare
// selectAll() returns only the current tenant's rows.

const buildFindUsersInOrg = (trx: Tx) => trx.selectFrom('user').selectAll();

export type ListUsersInOrgResultItem = InferResult<
  ReturnType<typeof buildFindUsersInOrg>
>[number];

export async function listUsersInOrg(
  trx: Tx
): Promise<ListUsersInOrgResultItem[]> {
  return buildFindUsersInOrg(trx).execute();
}
