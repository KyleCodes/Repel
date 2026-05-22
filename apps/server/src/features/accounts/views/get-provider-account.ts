import type { InferResult } from 'kysely';
import type { Tx } from '../../../infra/db/types.ts';

// Lookup a single provider account by id. RLS scopes the row to the current
// org, so a cross-tenant id resolves to undefined rather than another org's
// row.

const buildGetProviderAccount = (trx: Tx, input: { id: string }) =>
  trx.selectFrom('providerAccount').selectAll().where('id', '=', input.id);

export type GetProviderAccountResult = InferResult<
  ReturnType<typeof buildGetProviderAccount>
>[number];

export type GetProviderAccountInput = { id: string };

export async function getProviderAccount(
  trx: Tx,
  input: GetProviderAccountInput
): Promise<GetProviderAccountResult | undefined> {
  return buildGetProviderAccount(trx, input).executeTakeFirst();
}
