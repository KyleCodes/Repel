import { describe, expect, test } from 'bun:test';
import { withTxContext } from '../../tx';
import type { Tx } from '../../types';
import { migrationsService } from '../service';

// Fakes a Kysely transaction chain — selectFrom().select().orderBy().execute()
function makeFakeTx(behavior: {
  execute: () => Promise<Array<{ name: string; runOn: Date }>>;
}): Tx {
  const chain = {
    select: function () {
      return chain;
    },
    orderBy: function () {
      return chain;
    },
    execute: behavior.execute,
  };
  return {
    selectFrom: function () {
      return chain;
    },
  } as unknown as Tx;
}

describe('migrationsService.listApplied', function () {
  test('maps rows to AppliedMigration domain objects', async function () {
    const ranAt = new Date('2026-05-12T00:00:00.000Z');
    const trx = makeFakeTx({
      execute: async function () {
        return [
          { name: '1700000000000_rep-1', runOn: ranAt },
          { name: '1750000000000_rep-39', runOn: ranAt },
        ];
      },
    });

    const result = await withTxContext({ trx, orgId: null }, function () {
      return migrationsService.listApplied();
    });

    expect(result).toEqual([
      { name: '1700000000000_rep-1', runOn: ranAt },
      { name: '1750000000000_rep-39', runOn: ranAt },
    ]);
  });

  test('returns [] when underlying table missing (SQLSTATE 42P01)', async function () {
    const trx = makeFakeTx({
      execute: async function () {
        const err = new Error(
          'relation "pgmigrations" does not exist'
        ) as Error & { code: string };
        err.code = '42P01';
        throw err;
      },
    });

    const result = await withTxContext({ trx, orgId: null }, function () {
      return migrationsService.listApplied();
    });

    expect(result).toEqual([]);
  });

  test('rethrows non-42P01 errors', async function () {
    const trx = makeFakeTx({
      execute: async function () {
        const err = new Error('connection refused') as Error & {
          code: string;
        };
        err.code = '08006';
        throw err;
      },
    });

    await expect(
      withTxContext({ trx, orgId: null }, function () {
        return migrationsService.listApplied();
      })
    ).rejects.toThrow('connection refused');
  });

  test('rethrows errors with no SQLSTATE code', async function () {
    const trx = makeFakeTx({
      execute: async function () {
        throw new Error('unexpected');
      },
    });

    await expect(
      withTxContext({ trx, orgId: null }, function () {
        return migrationsService.listApplied();
      })
    ).rejects.toThrow('unexpected');
  });

  test('returns empty array when no rows', async function () {
    const trx = makeFakeTx({
      execute: async function () {
        return [];
      },
    });

    const result = await withTxContext({ trx, orgId: null }, function () {
      return migrationsService.listApplied();
    });

    expect(result).toEqual([]);
  });
});
