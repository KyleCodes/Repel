import { describe, expect, test } from 'bun:test';
import type { DbExecutor, PgMigrationsRow } from '../../../db/types.ts';
import { makeMigrationsRepo } from '../repo.ts';

// Fakes a Kysely query chain — selectFrom().selectAll().orderBy().execute()
function makeFakeExecutor(behavior: {
  execute: () => Promise<PgMigrationsRow[]>;
}): DbExecutor {
  const chain = {
    selectAll: function () {
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
  } as unknown as DbExecutor;
}

describe('makeMigrationsRepo', function () {
  test('listApplied returns rows when pgmigrations exists', async function () {
    const ranAt = new Date('2026-05-12T00:00:00.000Z');
    const rows: PgMigrationsRow[] = [
      { id: 1, name: '1700000000000_rep-1', runOn: ranAt },
    ];
    const repo = makeMigrationsRepo(
      makeFakeExecutor({
        execute: async function () {
          return rows;
        },
      })
    );

    expect(await repo.listApplied()).toEqual(rows);
  });

  test('listApplied returns [] when underlying table missing (SQLSTATE 42P01)', async function () {
    const repo = makeMigrationsRepo(
      makeFakeExecutor({
        execute: async function () {
          const err = new Error(
            'relation "pgmigrations" does not exist'
          ) as Error & {
            code: string;
          };
          err.code = '42P01';
          throw err;
        },
      })
    );

    expect(await repo.listApplied()).toEqual([]);
  });

  test('listApplied rethrows non-42P01 errors', async function () {
    const repo = makeMigrationsRepo(
      makeFakeExecutor({
        execute: async function () {
          const err = new Error('connection refused') as Error & {
            code: string;
          };
          err.code = '08006';
          throw err;
        },
      })
    );

    await expect(repo.listApplied()).rejects.toThrow('connection refused');
  });

  test('listApplied rethrows errors with no SQLSTATE code', async function () {
    const repo = makeMigrationsRepo(
      makeFakeExecutor({
        execute: async function () {
          throw new Error('unexpected');
        },
      })
    );

    await expect(repo.listApplied()).rejects.toThrow('unexpected');
  });
});
