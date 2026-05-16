import type { InferResult } from 'kysely';
import type { Tx } from '../../../infra/db/types.ts';

const buildFindUserById = (trx: Tx, input: { id: string }) =>
  trx.selectFrom('user').selectAll().where('id', '=', input.id);

export type GetUserByIdResult = InferResult<
  ReturnType<typeof buildFindUserById>
>[number];

export type GetUserByIdInput = { id: string };

export async function getUserById(
  trx: Tx,
  input: GetUserByIdInput
): Promise<GetUserByIdResult | undefined> {
  return buildFindUserById(trx, input).executeTakeFirst();
}
