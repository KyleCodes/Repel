import type { Org, User } from '@repel/backend-db/prisma/client';
import type {
  OrgUncheckedCreateInput,
  UserUncheckedCreateInput,
} from '@repel/backend-db/prisma/models';
import { type Sql, sql } from '@repel/backend-db/sql';
import type { Tx } from '@repel/backend-db/types';

// Bootstrap mutation: create the first org and its admin user in one round trip.
//
// A writeable CTE chains both inserts inside a single statement — the query
// API cannot express this, so the statement is raw SQL. The final SELECT
// projects each inserted row as a JSON object (camelCase keys aliased in the
// inner selects) so the returned shape is `{ org: {...}, user: {...} }`
// end-to-end — no application-side reshape.
//
// Known caveat (carried over from the Kysely version): to_json() serializes
// timestamptz as ISO strings. The declared types say Date; the wire delivers
// string. The service boundary coerces with new Date() where it matters.

export const buildBootstrap = (input: BootstrapInput): Sql => sql`
  WITH new_org AS (
    INSERT INTO org (name) VALUES (${input.org.name}) RETURNING *
  ), new_user AS (
    INSERT INTO "user" (org_id, email, name, role)
    SELECT new_org.id, ${input.user.email}, ${input.user.name ?? null}, 'admin'
    FROM new_org
    RETURNING *
  )
  SELECT
    (SELECT to_json(o) FROM (
      SELECT id, name,
             created_at AS "createdAt",
             updated_at AS "updatedAt"
      FROM new_org) o) AS "org",
    (SELECT to_json(u) FROM (
      SELECT id, email, name, role,
             org_id     AS "orgId",
             created_at AS "createdAt",
             updated_at AS "updatedAt"
      FROM new_user) u) AS "user"`;

export type BootstrapResult = {
  org: Org;
  user: User;
};

export type BootstrapInput = {
  org: OrgUncheckedCreateInput;
  user: Omit<UserUncheckedCreateInput, 'orgId' | 'role'>;
};

export async function bootstrap(
  trx: Tx,
  input: BootstrapInput
): Promise<BootstrapResult> {
  const rows = await trx.$queryRaw<BootstrapResult[]>(buildBootstrap(input));
  return rows[0]!;
}
