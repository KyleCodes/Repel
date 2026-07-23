import type { User } from '@repel/backend-db/prisma/client';
import type { Tx } from '@repel/backend-db/types';

// Lookup a user by email. Caller-supplied trx; transaction ownership
// is the service layer's responsibility.

export type FindUserByEmailResult = User;

export type FindUserByEmailInput = { user: Pick<User, 'email'> };

export async function findUserByEmail(
  trx: Tx,
  input: FindUserByEmailInput
): Promise<FindUserByEmailResult | undefined> {
  const row = await trx.user.findFirst({
    where: { email: input.user.email },
  });
  return row ?? undefined;
}
