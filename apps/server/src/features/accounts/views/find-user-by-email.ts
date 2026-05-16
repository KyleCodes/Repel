import type { InferResult } from 'kysely';
import type { Tx } from '../../../infra/db/types.ts';

// Lookup a user row by email. Caller-supplied trx; transaction ownership
// is the service layer's responsibility.

const buildFindUserByEmail = (trx: Tx, input: { email: string }) =>
  trx.selectFrom('user').selectAll().where('email', '=', input.email);

export type FindUserByEmailResult = InferResult<
  ReturnType<typeof buildFindUserByEmail>
>[number];

export type FindUserByEmailInput = { email: string };

export async function findUserByEmail(
  trx: Tx,
  input: FindUserByEmailInput
): Promise<FindUserByEmailResult | undefined> {
  return buildFindUserByEmail(trx, input).executeTakeFirst();
}
