import type { InferResult, Selectable } from 'kysely';
import type { ProviderAccount } from '../../../infra/db/generated.ts';
import type { Tx } from '../../../infra/db/types.ts';

// Soft-delete: flips `isActive` to false. One statement (manifesto Rule 3).
// `returningAll()` hands the updated row back so the caller can confirm the
// account existed (RLS scopes the UPDATE — a cross-tenant id matches no row
// and the runner returns undefined).

const buildDeactivateProviderAccount = (
  trx: Tx,
  input: DeactivateProviderAccountInput
) =>
  trx
    .updateTable('providerAccount')
    .set({ isActive: false })
    .where('id', '=', input.providerAccount.id)
    .returningAll();

export type DeactivateProviderAccountResult = InferResult<
  ReturnType<typeof buildDeactivateProviderAccount>
>[number];

export type DeactivateProviderAccountInput = {
  providerAccount: Pick<Selectable<ProviderAccount>, 'id'>;
};

export async function deactivateProviderAccount(
  trx: Tx,
  input: DeactivateProviderAccountInput
): Promise<DeactivateProviderAccountResult | undefined> {
  return buildDeactivateProviderAccount(trx, input).executeTakeFirst();
}
