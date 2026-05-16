import { describe, expect, test } from 'bun:test';
import { runInOrgTx, runInTx, withTxContext } from '../tx.ts';
import type { Tx } from '../types.ts';

// These tests exercise the three ambient-tx guard cases in the decorators
// plus the ambient-handle-reuse property. withTxContext sets an
// AsyncLocalStorage frame without touching a real DB, so the guards that
// fire *before* any query execute are fully exercised without Postgres.
// The happy-path "opens a new tx" branches are covered by service
// integration tests.

// A Tx stub. The guard branches never touch it — they throw first.
// The reuse-property tests use referential equality on this fake.
const fakeTx = {} as Tx;

describe('runInOrgTx guards', function () {
  test('refuses to join a runInTx ambient (no org context)', async function () {
    const decorated = runInOrgTx(async function (
      _trx,
      input: { orgId: string }
    ) {
      return input.orgId;
    });

    await expect(
      withTxContext({ trx: fakeTx, orgId: null }, function () {
        return decorated({ orgId: 'org-1' });
      })
    ).rejects.toThrow(/cannot call tenant-scoped service inside runInTx/);
  });

  test('refuses to join an ambient scoped to a different org', async function () {
    const decorated = runInOrgTx(async function (
      _trx,
      input: { orgId: string }
    ) {
      return input.orgId;
    });

    await expect(
      withTxContext({ trx: fakeTx, orgId: 'org-1' }, function () {
        return decorated({ orgId: 'org-2' });
      })
    ).rejects.toThrow(/refusing to join as org-2/);
  });

  test('joins an ambient scoped to the same org (passes ambient trx through)', async function () {
    const decorated = runInOrgTx(async function (
      trx,
      input: { orgId: string }
    ) {
      return { saw: input.orgId, trxEq: trx === fakeTx };
    });

    const result = await withTxContext(
      { trx: fakeTx, orgId: 'org-1' },
      function () {
        return decorated({ orgId: 'org-1' });
      }
    );

    expect(result).toEqual({ saw: 'org-1', trxEq: true });
  });
});

describe('runInTx guards', function () {
  test('refuses to join an org-scoped ambient', async function () {
    const decorated = runInTx(async function () {
      return 'ok';
    });

    await expect(
      withTxContext({ trx: fakeTx, orgId: 'org-1' }, function () {
        return decorated({});
      })
    ).rejects.toThrow(/refusing to join an org-scoped ambient transaction/);
  });

  test('joins an unscoped ambient (passes ambient trx through)', async function () {
    const decorated = runInTx(async function (trx, input: { tag: string }) {
      return { tag: input.tag, trxEq: trx === fakeTx };
    });

    const result = await withTxContext(
      { trx: fakeTx, orgId: null },
      function () {
        return decorated({ tag: 'nested' });
      }
    );
    expect(result).toEqual({ tag: 'nested', trxEq: true });
  });
});
