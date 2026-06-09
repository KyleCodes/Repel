import type { InferResult, Selectable } from 'kysely';
import type { Org } from '../../../infra/db/generated.ts';
import type { Tx } from '../../../infra/db/types.ts';

const buildFindOrgById = (trx: Tx, input: GetOrgByIdInput) =>
  trx.selectFrom('org').selectAll().where('id', '=', input.org.id);

export type GetOrgByIdResult = InferResult<
  ReturnType<typeof buildFindOrgById>
>[number];

export type GetOrgByIdInput = { org: Pick<Selectable<Org>, 'id'> };

export async function getOrgById(
  trx: Tx,
  input: GetOrgByIdInput
): Promise<GetOrgByIdResult | undefined> {
  return buildFindOrgById(trx, input).executeTakeFirst();
}
