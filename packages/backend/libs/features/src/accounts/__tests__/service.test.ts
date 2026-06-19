import { describe, expect, test } from 'bun:test';
import { DBError, DBUniqueViolationError } from '@repel/backend-db/error';
import { withTxContext } from '@repel/backend-db/tx';
import type { Tx } from '@repel/backend-db/types';
import { DuplicateProviderAccountError } from '../error';
import { accountsService } from '../service';

// The service's addProviderAccount wraps the mutation and maps a
// DBUniqueViolationError to DuplicateProviderAccountError. Raw pg errors are
// classified into the DBError family by the tx decorator before the service's
// catch runs (covered in tx.test.ts / error.test.ts), so here the fake `exec`
// throws the already-classified DBUniqueViolationError directly. The mutation
// builds an insert on the supplied Tx and calls executeTakeFirstOrThrow(); we
// drive its behaviour by supplying a fake Tx whose insert chain resolves or
// rejects as the test dictates. No mock.module (it leaks process-globally and
// breaks sibling tests), no database — withTxContext supplies an ambient
// org-scoped frame so runInOrgTx joins it (the tx.test.ts idiom).

// Build a fake Tx whose insertInto(...).values(...).returningAll()
// .executeTakeFirstOrThrow() delegates to `exec`.
function makeFakeTx(exec: () => Promise<unknown>): Tx {
  const chain = {
    values() {
      return this;
    },
    returningAll() {
      return this;
    },
    executeTakeFirstOrThrow() {
      return exec();
    },
  };
  return {
    insertInto() {
      return chain;
    },
  } as unknown as Tx;
}

const input = {
  orgId: 'org-1',
  providerAccount: {
    orgId: 'org-1',
    userId: 'user-1',
    provider: 'gmail' as const,
    channel: 'email' as const,
    authMethod: 'oauth2' as const,
    externalAccountId: 'user@gmail.com',
    credentialsEncrypted: Buffer.from('creds', 'utf8'),
  },
};

function call(exec: () => Promise<unknown>) {
  return withTxContext({ trx: makeFakeTx(exec), orgId: 'org-1' }, function () {
    return accountsService.addProviderAccount(input);
  });
}

describe('accountsService.addProviderAccount', function () {
  test('returns the inserted row on success', async function () {
    const row = { id: 'pa-99', externalAccountId: 'user@gmail.com' };
    expect(
      await call(async function () {
        return row;
      })
    ).toEqual(row as never);
  });

  test('maps a DBUniqueViolationError to DuplicateProviderAccountError', async function () {
    let caught: unknown;
    try {
      await call(async function () {
        throw new DBUniqueViolationError(
          'unique constraint violated',
          'provider_account_uniq_org_id_provider_external_account_id',
          '23505'
        );
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(DuplicateProviderAccountError);
  });

  test('does not map a non-unique DB error to DuplicateProviderAccountError', async function () {
    // The tx decorator classifies the raw error into a DBError (not a unique
    // violation); the service leaves it alone, so it surfaces as a plain DBError.
    let caught: unknown;
    try {
      await call(async function () {
        throw new Error('boom');
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(DBError);
    expect(caught).not.toBeInstanceOf(DuplicateProviderAccountError);
  });
});
