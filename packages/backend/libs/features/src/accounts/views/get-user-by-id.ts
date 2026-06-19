import type { InferResult, Selectable } from 'kysely';
import type { User } from '@repel/backend-db/generated';
import type { Tx } from '@repel/backend-db/types';

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
