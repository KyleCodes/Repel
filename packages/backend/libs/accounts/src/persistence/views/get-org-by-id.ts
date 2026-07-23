import type { Org } from '@repel/backend-db/prisma/client';
import type { Tx } from '@repel/backend-db/types';

export type GetOrgByIdResult = Org;

export type GetOrgByIdInput = { org: Pick<Org, 'id'> };

export async function getOrgById(
  trx: Tx,
  input: GetOrgByIdInput
): Promise<GetOrgByIdResult | undefined> {
  const row = await trx.org.findUnique({ where: { id: input.org.id } });
  return row ?? undefined;
}
