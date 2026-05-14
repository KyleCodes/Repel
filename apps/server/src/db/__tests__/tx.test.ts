import { describe, expect, test } from 'bun:test';
import type { Repos } from '../../core/repos.ts';
import { runInOrgTx, runInTx, withTxContext } from '../tx.ts';

// These tests exercise the three ambient-tx guard cases in the decorators.
// withTxContext sets an AsyncLocalStorage frame without touching a real DB,
// so the guards that fire *before* any query execute are fully exercised
// without Postgres. The happy-path "opens a new tx" branches are covered
// by the service integration tests.

// A Repos stub. The guard branches never touch it — they throw first.
const fakeRepos = {} as Repos;

describe('runInOrgTx guards', function () {
  test('refuses to join a runInTx ambient (no org context)', async function () {
    const decorated = runInOrgTx(async function (_r, input: { orgId: string }) {
      return input.orgId;
    });

    await expect(
      withTxContext({ repos: fakeRepos, orgId: null }, function () {
        return decorated({ orgId: 'org-1' });
      })
    ).rejects.toThrow(/cannot call tenant-scoped service inside runInTx/);
  });

  test('refuses to join an ambient scoped to a different org', async function () {
    const decorated = runInOrgTx(async function (_r, input: { orgId: string }) {
      return input.orgId;
    });

    await expect(
      withTxContext({ repos: fakeRepos, orgId: 'org-1' }, function () {
        return decorated({ orgId: 'org-2' });
      })
    ).rejects.toThrow(/refusing to join as org-2/);
  });

  test('joins an ambient scoped to the same org (no DB call made)', async function () {
    const decorated = runInOrgTx(async function (
      repos,
      input: { orgId: string }
    ) {
      return { saw: input.orgId, reposEq: repos === fakeRepos };
    });

    const result = await withTxContext(
      { repos: fakeRepos, orgId: 'org-1' },
      function () {
        return decorated({ orgId: 'org-1' });
      }
    );

    expect(result).toEqual({ saw: 'org-1', reposEq: true });
  });

  test('accepts a bare orgId string as input', async function () {
    const decorated = runInOrgTx(async function (_repos, input: string) {
      return input;
    });

    const result = await withTxContext(
      { repos: fakeRepos, orgId: 'org-1' },
      function () {
        return decorated('org-1');
      }
    );
    expect(result).toBe('org-1');
  });
});

describe('runInTx guards', function () {
  test('refuses to join an org-scoped ambient', async function () {
    const decorated = runInTx(async function () {
      return 'ok';
    });

    await expect(
      withTxContext({ repos: fakeRepos, orgId: 'org-1' }, function () {
        return decorated({});
      })
    ).rejects.toThrow(/refusing to join an org-scoped ambient transaction/);
  });

  test('joins an unscoped ambient', async function () {
    const decorated = runInTx(async function (repos, input: { tag: string }) {
      return { tag: input.tag, reposEq: repos === fakeRepos };
    });

    const result = await withTxContext(
      { repos: fakeRepos, orgId: null },
      function () {
        return decorated({ tag: 'nested' });
      }
    );
    expect(result).toEqual({ tag: 'nested', reposEq: true });
  });
});
