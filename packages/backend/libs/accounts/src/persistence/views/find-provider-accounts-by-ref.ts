import type { InferResult, Selectable } from 'kysely';
import type { ProviderAccount } from '@repel/backend-db/generated';
import type { Tx } from '@repel/backend-db/types';

// Resolves a provider-account reference. A reference is one of two shapes:
//   - { alias } — a human-chosen alias.
//   - { provider, externalAccountId } — the natural key of the account at
//     its provider.
// Returns an array (never throws on 0/many) — the CLI resolver decides how
// to handle no-match and ambiguity. RLS scopes the query to the current org.

export type FindProviderAccountsByAliasInput = {
  providerAccount: Pick<Selectable<ProviderAccount>, 'alias'>;
};

export type FindProviderAccountsByProviderRefInput = {
  providerAccount: Pick<
    Selectable<ProviderAccount>,
    'provider' | 'externalAccountId'
  >;
};

export type FindProviderAccountsByRefInput =
  | FindProviderAccountsByAliasInput
  | FindProviderAccountsByProviderRefInput;

const buildFindProviderAccountsByRef = (
  trx: Tx,
  input: FindProviderAccountsByRefInput
) => {
  const base = trx.selectFrom('providerAccount').selectAll();
  if ('alias' in input.providerAccount) {
    return base.where('alias', '=', input.providerAccount.alias);
  }
  return base
    .where('provider', '=', input.providerAccount.provider)
    .where('externalAccountId', '=', input.providerAccount.externalAccountId);
};

export type FindProviderAccountsByRefResult = InferResult<
  ReturnType<typeof buildFindProviderAccountsByRef>
>[number];

export async function findProviderAccountsByRef(
  trx: Tx,
  input: FindProviderAccountsByRefInput
): Promise<FindProviderAccountsByRefResult[]> {
  return buildFindProviderAccountsByRef(trx, input).execute();
}
