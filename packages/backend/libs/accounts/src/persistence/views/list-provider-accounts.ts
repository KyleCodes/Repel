import type { ProviderAccount } from '@repel/backend-db/prisma/client';
import type { Tx } from '@repel/backend-db/types';
import {
  type ProviderAccountRow,
  toProviderAccountRow,
} from '../lib/credentials';

// Lists provider accounts for one user. RLS scopes the query to the current
// org; the explicit `WHERE userId =` clause is the ADR-013 user-visibility
// mechanism (RLS itself stays org-only — it does not filter by user).

export type ListProviderAccountsResult = ProviderAccountRow;

export type ListProviderAccountsInput = {
  providerAccount: Pick<ProviderAccount, 'userId'>;
};

export async function listProviderAccounts(
  trx: Tx,
  input: ListProviderAccountsInput
): Promise<ListProviderAccountsResult[]> {
  const rows = await trx.providerAccount.findMany({
    where: { userId: input.providerAccount.userId },
  });
  return rows.map(toProviderAccountRow);
}
