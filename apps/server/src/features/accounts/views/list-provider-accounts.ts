import type { InferResult, Selectable } from 'kysely';
import type { ProviderAccount } from '../../../infra/db/generated.ts';
import type { Tx } from '../../../infra/db/types.ts';

// Lists provider accounts for one user. RLS scopes the query to the current
// org; the explicit `WHERE userId =` clause is the ADR-013 user-visibility
// mechanism (RLS itself stays org-only — it does not filter by user).

const buildListProviderAccounts = (trx: Tx, input: ListProviderAccountsInput) =>
  trx
    .selectFrom('providerAccount')
    .selectAll()
    .where('userId', '=', input.providerAccount.userId);

export type ListProviderAccountsResult = InferResult<
  ReturnType<typeof buildListProviderAccounts>
>[number];

export type ListProviderAccountsInput = {
  providerAccount: Pick<Selectable<ProviderAccount>, 'userId'>;
};

export async function listProviderAccounts(
  trx: Tx,
  input: ListProviderAccountsInput
): Promise<ListProviderAccountsResult[]> {
  return buildListProviderAccounts(trx, input).execute();
}
