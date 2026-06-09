import type { InferResult, Selectable } from 'kysely';
import type { User } from '../../../infra/db/generated.ts';
import type { Tx } from '../../../infra/db/types.ts';

// Lookup a user by email. Caller-supplied trx; transaction ownership
// is the service layer's responsibility.

const buildFindUserByEmail = (trx: Tx, input: FindUserByEmailInput) =>
  trx.selectFrom('user').selectAll().where('email', '=', input.user.email);

export type FindUserByEmailResult = InferResult<
  ReturnType<typeof buildFindUserByEmail>
>[number];

export type FindUserByEmailInput = { user: Pick<Selectable<User>, 'email'> };

export async function findUserByEmail(
  trx: Tx,
  input: FindUserByEmailInput
): Promise<FindUserByEmailResult | undefined> {
  return buildFindUserByEmail(trx, input).executeTakeFirst();
}
