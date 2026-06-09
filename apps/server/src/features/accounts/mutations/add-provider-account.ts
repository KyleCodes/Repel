import type { InferResult, Insertable } from 'kysely';
import type { ProviderAccount } from '../../../infra/db/generated.ts';
import type { Tx } from '../../../infra/db/types.ts';

// Insert a provider_account row and return it. One statement (manifesto Rule 3).
//
// org_id is written explicitly in .values() — the deliberate exception to "the
// inner flow never sees orgId". provider_account's RLS policy is USING-only (no
// WITH CHECK; migration rep-9), so Postgres reuses USING as the INSERT check and
// the new row MUST already carry the scoped org_id to satisfy it. An UPDATE
// (deactivate) targets an existing row that already passes USING, so it does not
// need this; an INSERT does.

// Exported for compile-only SQL-shape tests (it captures .values()); the thin
// async wrapper below is the runtime surface the service calls.
export const buildAddProviderAccount = (
  trx: Tx,
  input: AddProviderAccountInput
) =>
  trx
    .insertInto('providerAccount')
    .values(input.providerAccount)
    .returningAll();

export type AddProviderAccountResult = InferResult<
  ReturnType<typeof buildAddProviderAccount>
>[number];

export type AddProviderAccountInput = {
  providerAccount: Insertable<ProviderAccount>;
};

export async function addProviderAccount(
  trx: Tx,
  input: AddProviderAccountInput
): Promise<AddProviderAccountResult> {
  return buildAddProviderAccount(trx, input).executeTakeFirstOrThrow();
}
