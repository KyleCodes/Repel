import type { InferResult } from 'kysely';
import type { ProviderSlug } from '@repel/shared';
import type { Tx } from '../../../infra/db/types.ts';

// Resolves a provider-account reference. A reference is one of two shapes:
//   - { alias } — a human-chosen alias.
//   - { provider, externalAccountId } — the natural key of the account at
//     its provider.
// Returns an array (never throws on 0/many) — the CLI resolver decides how
// to handle no-match and ambiguity. RLS scopes the query to the current org.

export type FindProviderAccountsByAliasInput = { alias: string };

export type FindProviderAccountsByProviderRefInput = {
  provider: ProviderSlug;
  externalAccountId: string;
};

export type FindProviderAccountsByRefInput =
  | FindProviderAccountsByAliasInput
  | FindProviderAccountsByProviderRefInput;

const buildFindProviderAccountsByRef = (
  trx: Tx,
  input: FindProviderAccountsByRefInput
) => {
  const base = trx.selectFrom('providerAccount').selectAll();
  if ('alias' in input) {
    return base.where('alias', '=', input.alias);
  }
  return base
    .where('provider', '=', input.provider)
    .where('externalAccountId', '=', input.externalAccountId);
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
