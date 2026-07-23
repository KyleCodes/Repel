import { describe, expect, test } from 'bun:test';
import { withTxContext } from '../../tx';
import type { Tx } from '../../types';
import { migrationsService } from '../service';
import { buildListApplied } from '../views/list-applied';

// Fakes the one Tx member the view touches: $queryRaw.
function makeFakeTx(behavior: {
  queryRaw: () => Promise<Array<{ name: string; runOn: Date }>>;
}): Tx {
  return {
    $queryRaw: behavior.queryRaw,
  } as unknown as Tx;
}

describe('buildListApplied SQL shape', function () {
  test('reads finished, non-rolled-back rows from _prisma_migrations', function () {
    const query = buildListApplied();
    expect(query.sql).toContain('FROM _prisma_migrations');
    expect(query.sql).toContain('finished_at IS NOT NULL');
    expect(query.sql).toContain('rolled_back_at IS NULL');
    expect(query.sql).toContain('migration_name AS "name"');
    expect(query.sql).toContain('finished_at AS "runOn"');
  });
});

describe('migrationsService.listApplied', function () {
  test('maps rows to AppliedMigration domain objects', async function () {
    const ranAt = new Date('2026-05-12T00:00:00.000Z');
    const trx = makeFakeTx({
      queryRaw: async function () {
        return [
          { name: '0_init', runOn: ranAt },
          { name: '20260723_add_widget', runOn: ranAt },
        ];
      },
    });

    const result = await withTxContext({ trx, orgId: null }, function () {
      return migrationsService.listApplied();
    });

    expect(result).toEqual([
      { name: '0_init', runOn: ranAt },
      { name: '20260723_add_widget', runOn: ranAt },
    ]);
  });

  test('returns [] when underlying table missing (SQLSTATE 42P01)', async function () {
    const trx = makeFakeTx({
      queryRaw: async function () {
        const err = new Error(
          'relation "_prisma_migrations" does not exist'
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
      queryRaw: async function () {
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
      queryRaw: async function () {
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
      queryRaw: async function () {
        return [];
      },
    });

    const result = await withTxContext({ trx, orgId: null }, function () {
      return migrationsService.listApplied();
    });

    expect(result).toEqual([]);
  });
});
