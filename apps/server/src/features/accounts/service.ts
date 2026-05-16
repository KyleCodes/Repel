import { runInOrgTx, runInTx } from '../../infra/db/tx.ts';
import { UserAlreadyExistsError } from './error.ts';
import { type BootstrapResult, bootstrap } from './flows/bootstrap.ts';
import {
  type FindUserByEmailInput,
  findUserByEmail,
} from './views/find-user-by-email.ts';
import { type GetOrgByIdInput, getOrgById } from './views/get-org-by-id.ts';
import { type GetUserByIdInput, getUserById } from './views/get-user-by-id.ts';
import { listUsersInOrg } from './views/list-users-in-org.ts';

// Public surface of the accounts feature. The service owns transactions
// (every method is decorated with runInTx or runInOrgTx) and applies
// business rules (uniqueness checks, default roles). Flows and views hold
// query definitions only — they take a `trx` and run their statement, no
// decorators, no rules.
//
// runInOrgTx implicitly adds `orgId: string` to each tenant-scoped method's
// public input type. The view/flow inner function never sees `orgId` — it
// relies on RLS, scoped at SET LOCAL by the decorator.

export type BootstrapInput = {
  orgName: string;
  userEmail: string;
  userName?: string;
};

export const accountsService = {
  bootstrap: runInTx(async function (
    trx,
    input: BootstrapInput
  ): Promise<BootstrapResult> {
    const existing = await findUserByEmail(trx, { email: input.userEmail });
    if (existing) {
      throw new UserAlreadyExistsError(
        `already bootstrapped — user ${input.userEmail} exists in org ${existing.orgId}`
      );
    }
    return bootstrap(trx, {
      orgName: input.orgName,
      userEmail: input.userEmail,
      userName: input.userName ?? null,
    });
  }),

  findUserByEmail: runInTx(async function (trx, input: FindUserByEmailInput) {
    return findUserByEmail(trx, input);
  }),

  getOrgById: runInOrgTx(async function (trx, input: GetOrgByIdInput) {
    const row = await getOrgById(trx, input);
    if (!row) throw new Error(`Org ${input.id} not found`);
    return row;
  }),

  getUserById: runInOrgTx(async function (trx, input: GetUserByIdInput) {
    const row = await getUserById(trx, input);
    if (!row) throw new Error(`User ${input.id} not found`);
    return row;
  }),

  listUsersInOrg: runInOrgTx(async function (trx) {
    return listUsersInOrg(trx);
  }),
};
