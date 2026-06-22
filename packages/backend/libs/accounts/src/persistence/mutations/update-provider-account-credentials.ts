import type { InferResult, Selectable } from 'kysely';
import type { ProviderAccount } from '@repel/backend-db/generated';
import type { Tx } from '@repel/backend-db/types';

// Replace a provider account's stored credentials in place. One statement
// (manifesto Rule 3). Used by `accounts reconnect` to rotate the OAuth tokens
// after a fresh authorization without churning the row's id or any references
// to it. `returningAll()` hands the updated row back so the caller can confirm
// the account existed (RLS scopes the UPDATE — a cross-tenant id matches no row
// and the runner returns undefined). An UPDATE targets a row that already
// passes the USING policy, so no explicit org_id is needed (unlike the INSERT).

// Exported for compile-only SQL-shape tests; the async wrapper below is the
// runtime surface the service calls.
export const buildUpdateProviderAccountCredentials = (
  trx: Tx,
  input: UpdateProviderAccountCredentialsInput
) =>
  trx
    .updateTable('providerAccount')
    .set({ credentialsEncrypted: input.providerAccount.credentialsEncrypted })
    .where('id', '=', input.providerAccount.id)
    .returningAll();

export type UpdateProviderAccountCredentialsResult = InferResult<
  ReturnType<typeof buildUpdateProviderAccountCredentials>
>[number];

export type UpdateProviderAccountCredentialsInput = {
  providerAccount: Pick<
    Selectable<ProviderAccount>,
    'id' | 'credentialsEncrypted'
  >;
};

export async function updateProviderAccountCredentials(
  trx: Tx,
  input: UpdateProviderAccountCredentialsInput
): Promise<UpdateProviderAccountCredentialsResult | undefined> {
  return buildUpdateProviderAccountCredentials(trx, input).executeTakeFirst();
}
