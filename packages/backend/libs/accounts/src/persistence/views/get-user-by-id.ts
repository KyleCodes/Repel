import type { User } from '@repel/backend-db/prisma/client';
import type { Tx } from '@repel/backend-db/types';

export type GetUserByIdResult = User;

export type GetUserByIdInput = { user: Pick<User, 'id'> };

export async function getUserById(
  trx: Tx,
  input: GetUserByIdInput
): Promise<GetUserByIdResult | undefined> {
  const row = await trx.user.findUnique({ where: { id: input.user.id } });
  return row ?? undefined;
}
