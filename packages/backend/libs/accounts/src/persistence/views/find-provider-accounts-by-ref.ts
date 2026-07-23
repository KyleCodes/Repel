import type { ProviderAccount } from '@repel/backend-db/prisma/client';
import type { Tx } from '@repel/backend-db/types';
import {
  type ProviderAccountRow,
  toProviderAccountRow,
} from '../lib/credentials';

// Resolves a provider-account reference. A reference is one of two shapes:
//   - { alias } — a human-chosen alias.
//   - { provider, externalAccountId } — the natural key of the account at
//     its provider.
// Returns an array (never throws on 0/many) — the CLI resolver decides how
// to handle no-match and ambiguity. RLS scopes the query to the current org.

export type FindProviderAccountsByAliasInput = {
  providerAccount: Pick<ProviderAccount, 'alias'>;
};

export type FindProviderAccountsByProviderRefInput = {
  providerAccount: Pick<ProviderAccount, 'provider' | 'externalAccountId'>;
};

export type FindProviderAccountsByRefInput =
  | FindProviderAccountsByAliasInput
  | FindProviderAccountsByProviderRefInput;

export type FindProviderAccountsByRefResult = ProviderAccountRow;

export async function findProviderAccountsByRef(
  trx: Tx,
  input: FindProviderAccountsByRefInput
): Promise<FindProviderAccountsByRefResult[]> {
  const where =
    'alias' in input.providerAccount
      ? { alias: input.providerAccount.alias }
      : {
          provider: input.providerAccount.provider,
          externalAccountId: input.providerAccount.externalAccountId,
        };
  const rows = await trx.providerAccount.findMany({ where });
  return rows.map(toProviderAccountRow);
}
