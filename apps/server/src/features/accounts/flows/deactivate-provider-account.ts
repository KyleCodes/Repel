import type { InferResult } from 'kysely';
import type { Tx } from '../../../infra/db/types.ts';

// Soft-delete: flips `isActive` to false. One statement (manifesto Rule 3).
// `returningAll()` hands the updated row back so the caller can confirm the
// account existed (RLS scopes the UPDATE — a cross-tenant id matches no row
// and the runner returns undefined).

const buildDeactivateProviderAccount = (trx: Tx, input: { id: string }) =>
  trx
    .updateTable('providerAccount')
    .set({ isActive: false })
    .where('id', '=', input.id)
    .returningAll();

export type DeactivateProviderAccountResult = InferResult<
  ReturnType<typeof buildDeactivateProviderAccount>
>[number];

export type DeactivateProviderAccountInput = { id: string };

export async function deactivateProviderAccount(
  trx: Tx,
  input: DeactivateProviderAccountInput
): Promise<DeactivateProviderAccountResult | undefined> {
  return buildDeactivateProviderAccount(trx, input).executeTakeFirst();
}
