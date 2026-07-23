import { describe, expect, test } from 'bun:test';
import { DBError, DBUniqueViolationError } from '@repel/backend-db/error';
import { withTxContext } from '@repel/backend-db/tx';
import type { Tx } from '@repel/backend-db/types';
import { DuplicateProviderAccountError } from '../error';
import { accountsService } from '../service';

// The service's addProviderAccount wraps the mutation and maps a
// DBUniqueViolationError to DuplicateProviderAccountError. Raw pg/Prisma
// errors are classified into the DBError family by the tx decorator before the
// service's catch runs (covered in tx.test.ts / error.test.ts), so here the
// fake `exec` throws the already-classified DBUniqueViolationError directly.
// The mutation calls trx.providerAccount.create(); we drive its behaviour by
// supplying a fake Tx whose create delegates to `exec`. No mock.module (it
// leaks process-globally and breaks sibling tests), no database — withTxContext
// supplies an ambient org-scoped frame so runInOrgTx joins it (the tx.test.ts
// idiom).

function makeFakeTx(exec: () => Promise<unknown>): Tx {
  return {
    providerAccount: {
      create() {
        return exec();
      },
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
    const row = {
      id: 'pa-99',
      externalAccountId: 'user@gmail.com',
      credentialsEncrypted: null,
    };
    expect(
      await call(async function () {
        return row;
      })
    ).toEqual(row as never);
  });

  test('converts a Uint8Array credentials column back to Buffer', async function () {
    const stored = new Uint8Array([1, 2, 3]);
    const result = await call(async function () {
      return { id: 'pa-99', credentialsEncrypted: stored };
    });
    expect(Buffer.isBuffer(result.credentialsEncrypted)).toBe(true);
    expect(result.credentialsEncrypted).toEqual(Buffer.from([1, 2, 3]));
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
