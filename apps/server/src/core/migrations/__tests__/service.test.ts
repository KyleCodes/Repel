import { describe, expect, test } from 'bun:test';
import { withTxContext } from '../../../db/tx.ts';
import type { PgMigrationsRow } from '../../../db/types.ts';
import type { Repos } from '../../repos.ts';
import { migrationsService } from '../service.ts';

function makeFakeRepos(rows: PgMigrationsRow[]): Repos {
  return {
    migrations: {
      listApplied: async function (): Promise<PgMigrationsRow[]> {
        return rows;
      },
    },
  } as unknown as Repos;
}

describe('migrationsService.listApplied', function () {
  test('maps repo rows to AppliedMigration domain objects', async function () {
    const ranAt = new Date('2026-05-12T00:00:00.000Z');
    const repos = makeFakeRepos([
      { id: 1, name: '1700000000000_rep-1', runOn: ranAt },
      { id: 2, name: '1750000000000_rep-39', runOn: ranAt },
    ]);

    const result = await withTxContext({ repos, orgId: null }, function () {
      return migrationsService.listApplied();
    });

    expect(result).toEqual([
      { name: '1700000000000_rep-1', runOn: ranAt },
      { name: '1750000000000_rep-39', runOn: ranAt },
    ]);
  });

  test('returns empty array when repo returns empty', async function () {
    const repos = makeFakeRepos([]);

    const result = await withTxContext({ repos, orgId: null }, function () {
      return migrationsService.listApplied();
    });

    expect(result).toEqual([]);
  });
});
