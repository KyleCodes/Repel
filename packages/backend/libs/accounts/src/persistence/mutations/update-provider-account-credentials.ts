import { isNoResultError } from '@repel/backend-db/error';
import type { ProviderAccount } from '@repel/backend-db/prisma/client';
import type { Tx } from '@repel/backend-db/types';
import {
  type ProviderAccountRow,
  toProviderAccountRow,
} from '../lib/credentials';

// Replace a provider account's stored credentials in place. One statement
// (manifesto Rule 3). Used by `accounts reconnect` to rotate the OAuth tokens
// after a fresh authorization without churning the row's id or any references
// to it. The updated row is handed back so the caller can confirm the account
// existed (RLS scopes the UPDATE — a cross-tenant id matches no row and the
// runner returns undefined). An UPDATE targets a row that already passes the
// USING policy, so no explicit org_id is needed (unlike the INSERT).

export type UpdateProviderAccountCredentialsInput = {
  providerAccount: Pick<ProviderAccount, 'id'> & {
    credentialsEncrypted: Buffer;
  };
};

export type UpdateProviderAccountCredentialsResult = ProviderAccountRow;

export async function updateProviderAccountCredentials(
  trx: Tx,
  input: UpdateProviderAccountCredentialsInput
): Promise<UpdateProviderAccountCredentialsResult | undefined> {
  try {
    const row = await trx.providerAccount.update({
      where: { id: input.providerAccount.id },
      data: {
        // Buffer → the input type Prisma wants; see AddProviderAccountInput.
        credentialsEncrypted: input.providerAccount
          .credentialsEncrypted as Uint8Array<ArrayBuffer>,
      },
    });
    return toProviderAccountRow(row);
  } catch (err) {
    if (isNoResultError(err)) return undefined;
    throw err;
  }
}
