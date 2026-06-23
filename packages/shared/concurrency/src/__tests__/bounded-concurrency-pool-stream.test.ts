import { describe, expect, test } from 'bun:test';
import { boundedConcurrencyPoolStream } from '../bounded-concurrency-pool-stream';

async function tick(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it) out.push(v);
  return out;
}

describe('boundedConcurrencyPoolStream', function () {
  test('yields in completion order, not source order', async function () {
    // Item 0 is slow, item 1 is fast — so 1 completes (and yields) first.
    const stream = boundedConcurrencyPoolStream([0, 1], 2, async function (n) {
      await new Promise((r) => setTimeout(r, n === 0 ? 20 : 1));
      return n;
    });
    expect(await collect(stream)).toEqual([1, 0]);
  });

  test('never runs more than `size` invocations at once', async function () {
    let active = 0;
    let max = 0;
    const stream = boundedConcurrencyPoolStream(
      [0, 1, 2, 3, 4, 5, 6, 7],
      3,
      async function () {
        active += 1;
        max = Math.max(max, active);
        await new Promise((r) => setTimeout(r, 5));
        active -= 1;
      }
    );
    await collect(stream);
    expect(max).toBe(3);
  });

  test('pulls the source lazily — no further than `size` ahead', async function () {
    let pulled = 0;
    async function* source() {
      for (let i = 0; i < 10; i++) {
        pulled += 1;
        yield i;
      }
    }
    // size 2: the pool admits 2, so at most ~size+1 items are ever pulled before
    // the consumer starts draining. Gate the work so nothing completes yet.
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const stream = boundedConcurrencyPoolStream(source(), 2, async function () {
      await gate;
    });
    const it = stream[Symbol.asyncIterator]();
    void it.next(); // kick the producer
    await tick();
    await tick();
    // The source has not been drained to completion — only a bounded prefix.
    expect(pulled).toBeLessThanOrEqual(3);
    release();
    // Drain the rest so the generator settles.
    while (!(await it.next()).done) {
      /* drain */
    }
    expect(pulled).toBe(10);
  });

  test('the first rejection fails the stream; no completed event after', async function () {
    const seen: number[] = [];
    let caught: unknown;
    try {
      for await (const v of boundedConcurrencyPoolStream(
        [0, 1, 2],
        1,
        async function (n) {
          if (n === 1) throw new Error('item 1 failed');
          return n;
        }
      )) {
        seen.push(v);
      }
    } catch (e) {
      caught = e;
    }
    expect(seen).toEqual([0]); // 0 yielded before 1 threw (size 1 ⇒ ordered)
    expect((caught as Error).message).toBe('item 1 failed');
  });

  test('an empty source yields nothing', async function () {
    expect(
      await collect(boundedConcurrencyPoolStream([], 4, async (n) => n))
    ).toEqual([]);
  });

  test('a source longer than `size` stays bounded and yields all', async function () {
    const items = Array.from({ length: 20 }, (_, i) => i);
    let active = 0;
    let max = 0;
    const out = await collect(
      boundedConcurrencyPoolStream(items, 4, async function (n) {
        active += 1;
        max = Math.max(max, active);
        await new Promise((r) => setTimeout(r, 2));
        active -= 1;
        return n;
      })
    );
    expect(max).toBe(4);
    expect(out.slice().sort((a, b) => a - b)).toEqual(items);
  });

  test('a source that throws fails the stream', async function () {
    async function* source(): AsyncGenerator<number> {
      yield 0;
      throw new Error('pagination failed');
    }
    let caught: unknown;
    try {
      await collect(boundedConcurrencyPoolStream(source(), 2, async (n) => n));
    } catch (e) {
      caught = e;
    }
    expect((caught as Error).message).toBe('pagination failed');
  });

  test('breaking out early stops the producer pulling the source', async function () {
    let pulled = 0;
    async function* source() {
      for (let i = 0; i < 100; i++) {
        pulled += 1;
        yield i;
      }
    }
    const stream = boundedConcurrencyPoolStream(source(), 2, async (n) => n);
    for await (const v of stream) {
      if (v >= 0) break; // take exactly one, then bail
    }
    const pulledAtBreak = pulled;
    await tick();
    await tick();
    // After the break, the producer must not keep draining the 100-item source.
    expect(pulled).toBe(pulledAtBreak);
    expect(pulled).toBeLessThan(100);
  });
});
