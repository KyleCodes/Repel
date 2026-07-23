import { isNoResultError } from '@repel/backend-db/error';
import type { ProviderAccount } from '@repel/backend-db/prisma/client';
import type { Tx } from '@repel/backend-db/types';
import {
  type ProviderAccountRow,
  toProviderAccountRow,
} from '../lib/credentials';

// Soft-delete: flips `isActive` to false. One statement (manifesto Rule 3).
// The updated row is handed back so the caller can confirm the account existed
// (RLS scopes the UPDATE — a cross-tenant id matches no row; Prisma raises
// its no-row error, mapped here to the undefined the contract has always had).

export type DeactivateProviderAccountInput = {
  providerAccount: Pick<ProviderAccount, 'id'>;
};

export type DeactivateProviderAccountResult = ProviderAccountRow;

export async function deactivateProviderAccount(
  trx: Tx,
  input: DeactivateProviderAccountInput
): Promise<DeactivateProviderAccountResult | undefined> {
  try {
    const row = await trx.providerAccount.update({
      where: { id: input.providerAccount.id },
      data: { isActive: false },
    });
    return toProviderAccountRow(row);
  } catch (err) {
    if (isNoResultError(err)) return undefined;
    throw err;
  }
}
