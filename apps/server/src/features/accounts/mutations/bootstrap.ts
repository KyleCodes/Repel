import type { InferResult } from 'kysely';
import { jsonObjectFrom } from 'kysely/helpers/postgres';
import type { Tx } from '../../../infra/db/types.ts';

// Bootstrap mutation: create the first org and its admin user in one round trip.
//
// Writeable CTE chains both inserts inside a single statement. The final
// SELECT projects each inserted row as a JSON object via jsonObjectFrom,
// so the returned shape is `{ org: {...}, user: {...} }` end-to-end — no
// application-side reshape.
//
// Known caveat: jsonObjectFrom wraps results in to_json(), which serializes
// timestamptz as ISO strings. Kysely's inferred type says Date; the wire
// delivers string. Tracked at kysely-org/kysely#482. The service boundary
// coerces with new Date() where it matters.

const buildBootstrap = (
  trx: Tx,
  input: { orgName: string; userEmail: string; userName: string | null }
) =>
  trx
    .with('new_org', (qb) =>
      qb.insertInto('org').values({ name: input.orgName }).returningAll()
    )
    .with('new_user', (qb) =>
      qb
        .insertInto('user')
        .columns(['orgId', 'email', 'name', 'role'])
        .expression((eb) =>
          eb
            .selectFrom('new_org')
            .select((eb2) => [
              'new_org.id as orgId',
              eb2.val(input.userEmail).as('email'),
              eb2.val(input.userName).as('name'),
              eb2.val<'admin'>('admin').as('role'),
            ])
        )
        .returningAll()
    )
    .selectNoFrom((eb) => [
      jsonObjectFrom(eb.selectFrom('new_org').selectAll()).as('org'),
      jsonObjectFrom(eb.selectFrom('new_user').selectAll()).as('user'),
    ]);

// jsonObjectFrom's inferred shape is `T | null` even when the sub-select is
// guaranteed to return a row (Postgres' to_json() of a single-row select
// can be null in the general case). Both objects are non-null here because
// the CTE wrote them in the same statement. We strip the null at this
// boundary so callers don't repeat the assertion.
type BootstrapRow = InferResult<ReturnType<typeof buildBootstrap>>[number];

export type BootstrapResult = {
  org: NonNullable<BootstrapRow['org']>;
  user: NonNullable<BootstrapRow['user']>;
};

export type BootstrapInput = {
  orgName: string;
  userEmail: string;
  userName: string | null;
};

export async function bootstrap(
  trx: Tx,
  input: BootstrapInput
): Promise<BootstrapResult> {
  const row = await buildBootstrap(trx, input).executeTakeFirstOrThrow();
  return { org: row.org!, user: row.user! };
}
