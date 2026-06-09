import type { InferResult, Selectable } from 'kysely';
import type { User } from '../../../infra/db/generated.ts';
import type { Tx } from '../../../infra/db/types.ts';

const buildFindUserById = (trx: Tx, input: GetUserByIdInput) =>
  trx.selectFrom('user').selectAll().where('id', '=', input.user.id);

export type GetUserByIdResult = InferResult<
  ReturnType<typeof buildFindUserById>
>[number];

export type GetUserByIdInput = { user: Pick<Selectable<User>, 'id'> };

export async function getUserById(
  trx: Tx,
  input: GetUserByIdInput
): Promise<GetUserByIdResult | undefined> {
  return buildFindUserById(trx, input).executeTakeFirst();
}
