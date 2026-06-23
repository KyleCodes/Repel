import { describe, expect, test } from 'bun:test';
import { runPool } from '../run-pool';

describe('runPool', function () {
  test('returns results in input order despite out-of-order completion', async function () {
    // Later items finish sooner (descending delay), so completion order is the
    // reverse of input order — the result array must still be input-ordered.
    const items = [0, 1, 2, 3, 4];
    const results = await runPool(items, 5, async function (n) {
      await new Promise((r) => setTimeout(r, (5 - n) * 3));
      return n * 2;
    });
    expect(results).toEqual(
      items.map((n) => ({ status: 'fulfilled', value: n * 2 }))
    );
  });

  test('a rejection becomes a rejected entry at the right index; siblings unaffected', async function () {
    const results = await runPool([0, 1, 2], 2, async function (n) {
      if (n === 1) throw new Error('item 1 failed');
      return n;
    });
    expect(results[0]).toEqual({ status: 'fulfilled', value: 0 });
    expect(results[1]!.status).toBe('rejected');
    expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(Error);
    expect(results[2]).toEqual({ status: 'fulfilled', value: 2 });
  });

  test('bounds concurrency to `size`', async function () {
    let active = 0;
    let max = 0;
    await runPool([0, 1, 2, 3, 4, 5, 6, 7], 3, async function () {
      active += 1;
      max = Math.max(max, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
    });
    expect(max).toBe(3);
  });

  test('an empty input resolves to an empty array', async function () {
    expect(await runPool([], 4, async (n) => n)).toEqual([]);
  });
});
