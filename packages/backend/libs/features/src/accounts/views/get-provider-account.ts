import type { InferResult, Selectable } from 'kysely';
import type { ProviderAccount } from '@repel/backend-db/generated';
import type { Tx } from '@repel/backend-db/types';

// Lookup a single provider account by id. RLS scopes the row to the current
// org, so a cross-tenant id resolves to undefined rather than another org's
// row.

const buildGetProviderAccount = (trx: Tx, input: GetProviderAccountInput) =>
  trx
    .selectFrom('providerAccount')
    .selectAll()
    .where('id', '=', input.providerAccount.id);

export type GetProviderAccountResult = InferResult<
  ReturnType<typeof buildGetProviderAccount>
>[number];

export type GetProviderAccountInput = {
  providerAccount: Pick<Selectable<ProviderAccount>, 'id'>;
};

export async function getProviderAccount(
  trx: Tx,
  input: GetProviderAccountInput
): Promise<GetProviderAccountResult | undefined> {
  return buildGetProviderAccount(trx, input).executeTakeFirst();
}
