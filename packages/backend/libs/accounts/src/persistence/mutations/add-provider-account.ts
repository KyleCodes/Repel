import type { ProviderAccountUncheckedCreateInput } from '@repel/backend-db/prisma/models';
import type { Tx } from '@repel/backend-db/types';
import {
  type ProviderAccountRow,
  toProviderAccountRow,
} from '../lib/credentials';

// Insert a provider_account row and return it. One statement (manifesto Rule 3).
//
// org_id is written explicitly in the data — the deliberate exception to "the
// inner mutation never sees orgId". provider_account's RLS policy is USING-only
// (no WITH CHECK), so Postgres reuses USING as the INSERT check and the new row
// MUST already carry the scoped org_id to satisfy it. An UPDATE (deactivate)
// targets an existing row that already passes USING, so it does not need this;
// an INSERT does. The unchecked create input keeps orgId a required field.

// credentialsEncrypted is re-declared as Buffer: callers hold Buffers, and
// TS 5.9 no longer treats Buffer as assignable to Prisma's
// Uint8Array<ArrayBuffer> input type. Runtime-compatible either way.
export type AddProviderAccountInput = {
  providerAccount: Omit<
    ProviderAccountUncheckedCreateInput,
    'credentialsEncrypted'
  > & { credentialsEncrypted?: Buffer | null };
};

export type AddProviderAccountResult = ProviderAccountRow;

export async function addProviderAccount(
  trx: Tx,
  input: AddProviderAccountInput
): Promise<AddProviderAccountResult> {
  const row = await trx.providerAccount.create({
    data: input.providerAccount as ProviderAccountUncheckedCreateInput,
  });
  return toProviderAccountRow(row);
}
