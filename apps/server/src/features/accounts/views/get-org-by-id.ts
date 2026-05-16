import type { InferResult } from 'kysely';
import type { Tx } from '../../../infra/db/types.ts';

const buildFindOrgById = (trx: Tx, input: { id: string }) =>
  trx.selectFrom('org').selectAll().where('id', '=', input.id);

export type GetOrgByIdResult = InferResult<
  ReturnType<typeof buildFindOrgById>
>[number];

export type GetOrgByIdInput = { id: string };

export async function getOrgById(
  trx: Tx,
  input: GetOrgByIdInput
): Promise<GetOrgByIdResult | undefined> {
  return buildFindOrgById(trx, input).executeTakeFirst();
}
