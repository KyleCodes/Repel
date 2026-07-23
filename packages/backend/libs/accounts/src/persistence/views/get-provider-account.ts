import type { ProviderAccount } from '@repel/backend-db/prisma/client';
import type { Tx } from '@repel/backend-db/types';
import {
  type ProviderAccountRow,
  toProviderAccountRow,
} from '../lib/credentials';

// Lookup a single provider account by id. RLS scopes the row to the current
// org, so a cross-tenant id resolves to undefined rather than another org's
// row.

export type GetProviderAccountResult = ProviderAccountRow;

export type GetProviderAccountInput = {
  providerAccount: Pick<ProviderAccount, 'id'>;
};

export async function getProviderAccount(
  trx: Tx,
  input: GetProviderAccountInput
): Promise<GetProviderAccountResult | undefined> {
  const row = await trx.providerAccount.findUnique({
    where: { id: input.providerAccount.id },
  });
  return row === null ? undefined : toProviderAccountRow(row);
}
