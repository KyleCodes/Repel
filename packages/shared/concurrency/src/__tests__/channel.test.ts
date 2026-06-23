import { describe, expect, test } from 'bun:test';
import { createChannel } from '../channel';

async function tick(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

// Drain a channel into an array (the channel must be closed/failed or this hangs).
async function collect<T>(ch: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of ch) out.push(v);
  return out;
}

describe('createChannel', function () {
  test('pushed values iterate in FIFO order then close ends iteration', async function () {
    const ch = createChannel<number>();
    ch.push(1);
    ch.push(2);
    ch.push(3);
    ch.close();
    expect(await collect(ch)).toEqual([1, 2, 3]);
  });

  test('close ends a consumer that is already waiting', async function () {
    const ch = createChannel<number>();
    let done = false;
    const consuming = collect(ch).then((v) => {
      done = true;
      return v;
    });
    await tick();
    expect(done).toBe(false); // parked, nothing buffered
    ch.close();
    expect(await consuming).toEqual([]);
    expect(done).toBe(true);
  });

  test('a push wakes a parked consumer', async function () {
    const ch = createChannel<string>();
    const seen: string[] = [];
    const consuming = (async () => {
      for await (const v of ch) seen.push(v);
    })();
    await tick();
    expect(seen).toEqual([]);
    ch.push('a');
    await tick();
    expect(seen).toEqual(['a']);
    ch.close();
    await consuming;
  });

  test('buffered values drain before close takes effect', async function () {
    const ch = createChannel<number>();
    ch.push(1);
    ch.push(2);
    ch.close();
    // Even though closed, the two buffered items still come out first.
    expect(await collect(ch)).toEqual([1, 2]);
  });

  test('fail throws out of the iterator, after buffered values drain', async function () {
    const ch = createChannel<number>();
    ch.push(1);
    ch.fail(new Error('boom'));
    const seen: number[] = [];
    let caught: unknown;
    try {
      for await (const v of ch) seen.push(v);
    } catch (e) {
      caught = e;
    }
    expect(seen).toEqual([1]); // buffered value came out first
    expect((caught as Error).message).toBe('boom');
  });

  test('first failure wins', async function () {
    const ch = createChannel<number>();
    ch.fail(new Error('first'));
    ch.fail(new Error('second'));
    let caught: unknown;
    try {
      await collect(ch);
    } catch (e) {
      caught = e;
    }
    expect((caught as Error).message).toBe('first');
  });

  test('interleaved push and consume', async function () {
    const ch = createChannel<number>();
    const seen: number[] = [];
    const consuming = (async () => {
      for await (const v of ch) {
        seen.push(v);
        if (v === 3) return;
      }
    })();
    for (const n of [1, 2, 3]) {
      ch.push(n);
      await tick();
    }
    await consuming;
    expect(seen).toEqual([1, 2, 3]);
  });
});
