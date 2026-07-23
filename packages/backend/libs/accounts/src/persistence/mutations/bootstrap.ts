import type { Org, User } from '@repel/backend-db/prisma/client';
import type {
  OrgUncheckedCreateInput,
  UserUncheckedCreateInput,
} from '@repel/backend-db/prisma/models';
import type { Tx } from '@repel/backend-db/types';

// Bootstrap mutation: create the first org and its admin user as one nested
// write — the ORM idiom for the old two-insert CTE. Prisma issues both inserts
// inside the ambient transaction, so the pair is atomic. (A side effect of
// leaving to_json() behind: timestamps now really are Date objects, matching
// the declared types — the old CTE delivered ISO strings at runtime.)

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
  const { users, ...org } = await trx.org.create({
    data: {
      name: input.org.name,
      users: {
        create: {
          email: input.user.email,
          name: input.user.name ?? null,
          role: 'admin',
        },
      },
    },
    include: { users: true },
  });
  return { org, user: users[0]! };
}
