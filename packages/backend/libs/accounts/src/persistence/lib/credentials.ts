import type { ProviderAccount } from '@repel/backend-db/prisma/client';

// Prisma returns bytea columns as Uint8Array; the crypto lib (and every
// existing caller) works with Buffer. Every provider-account row leaves this
// package through this seam so credentialsEncrypted keeps its Buffer contract.
export type ProviderAccountRow = Omit<
  ProviderAccount,
  'credentialsEncrypted'
> & {
  credentialsEncrypted: Buffer | null;
};

export function toProviderAccountRow(row: ProviderAccount): ProviderAccountRow {
  const bytes = row.credentialsEncrypted;
  return {
    ...row,
    credentialsEncrypted:
      bytes === null
        ? null
        : Buffer.isBuffer(bytes)
          ? bytes
          : Buffer.from(bytes),
  };
}
