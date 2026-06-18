import { DBUniqueViolationError } from '../../infra/db/error.ts';
import { runInOrgTx, runInTx } from '../../infra/db/tx.ts';
import {
  DuplicateProviderAccountError,
  OrgNotFoundError,
  ProviderAccountNotFoundError,
  UserAlreadyExistsError,
  UserNotFoundError,
} from './error.ts';
import {
  type AddProviderAccountInput,
  addProviderAccount,
} from './mutations/add-provider-account.ts';
import {
  type BootstrapInput,
  type BootstrapResult,
  bootstrap,
} from './mutations/bootstrap.ts';
import {
  type DeactivateProviderAccountInput,
  deactivateProviderAccount,
} from './mutations/deactivate-provider-account.ts';
import {
  type UpdateProviderAccountCredentialsInput,
  updateProviderAccountCredentials,
} from './mutations/update-provider-account-credentials.ts';
import {
  type FindProviderAccountsByRefInput,
  findProviderAccountsByRef,
} from './views/find-provider-accounts-by-ref.ts';
import {
  type FindUserByEmailInput,
  findUserByEmail,
} from './views/find-user-by-email.ts';
import { type GetOrgByIdInput, getOrgById } from './views/get-org-by-id.ts';
import {
  type GetProviderAccountInput,
  getProviderAccount,
} from './views/get-provider-account.ts';
import { type GetUserByIdInput, getUserById } from './views/get-user-by-id.ts';
import {
  type ListProviderAccountsInput,
  listProviderAccounts,
} from './views/list-provider-accounts.ts';
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

export const accountsService = {
  bootstrap: runInTx(async function (
    trx,
    input: BootstrapInput
  ): Promise<BootstrapResult> {
    const existing = await findUserByEmail(trx, {
      user: { email: input.user.email },
    });
    if (existing) {
      throw new UserAlreadyExistsError(
        `already bootstrapped — user ${input.user.email} exists in org ${existing.orgId}`
      );
    }
    return bootstrap(trx, input);
  }),

  findUserByEmail: runInTx(async function (trx, input: FindUserByEmailInput) {
    return findUserByEmail(trx, input);
  }),

  getOrgById: runInOrgTx(async function (trx, input: GetOrgByIdInput) {
    const org = await getOrgById(trx, input);
    if (!org) throw new OrgNotFoundError(`org ${input.org.id} not found`);
    return org;
  }),

  getUserById: runInOrgTx(async function (trx, input: GetUserByIdInput) {
    const user = await getUserById(trx, input);
    if (!user) throw new UserNotFoundError(`user ${input.user.id} not found`);
    return user;
  }),

  listUsersInOrg: runInOrgTx(async function (trx) {
    return listUsersInOrg(trx);
  }),

  listProviderAccounts: runInOrgTx(async function (
    trx,
    input: ListProviderAccountsInput
  ) {
    return listProviderAccounts(trx, input);
  }),

  getProviderAccount: runInOrgTx(async function (
    trx,
    input: GetProviderAccountInput
  ) {
    const providerAccount = await getProviderAccount(trx, input);
    if (!providerAccount) {
      throw new ProviderAccountNotFoundError(
        `provider account ${input.providerAccount.id} not found`
      );
    }
    return providerAccount;
  }),

  findProviderAccountsByRef: runInOrgTx(async function (
    trx,
    input: FindProviderAccountsByRefInput
  ) {
    return findProviderAccountsByRef(trx, input);
  }),

  addProviderAccount: runInOrgTx(async function (
    trx,
    input: AddProviderAccountInput
  ) {
    try {
      return await addProviderAccount(trx, input);
    } catch (e) {
      if (e instanceof DBUniqueViolationError) {
        throw new DuplicateProviderAccountError(
          `provider account for ${input.providerAccount.provider}:${input.providerAccount.externalAccountId} already exists`
        );
      }
      throw e;
    }
  }),

  deactivateProviderAccount: runInOrgTx(async function (
    trx,
    input: DeactivateProviderAccountInput
  ) {
    const providerAccount = await deactivateProviderAccount(trx, input);
    if (!providerAccount) {
      throw new ProviderAccountNotFoundError(
        `provider account ${input.providerAccount.id} not found`
      );
    }
    return providerAccount;
  }),

  updateProviderAccountCredentials: runInOrgTx(async function (
    trx,
    input: UpdateProviderAccountCredentialsInput
  ) {
    const providerAccount = await updateProviderAccountCredentials(trx, input);
    if (!providerAccount) {
      throw new ProviderAccountNotFoundError(
        `provider account ${input.providerAccount.id} not found`
      );
    }
    return providerAccount;
  }),
};
