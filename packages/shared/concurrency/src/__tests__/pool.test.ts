import { describe, expect, test } from 'bun:test';
import { createConcurrencyPool } from '../pool';

// A manually-resolved gate so a test controls exactly when a thunk finishes.
function gate(): { wait: Promise<void>; release: () => void } {
  let release!: () => void;
  const wait = new Promise<void>((r) => {
    release = r;
  });
  return { wait, release };
}

// Wrap a body in a counter that tracks concurrent invocations and the high-water
// mark, so a test can assert max-in-flight never exceeds the pool size.
function counted<T>(
  state: { active: number; max: number },
  body: () => Promise<T>
): () => Promise<T> {
  return async function () {
    state.active += 1;
    state.max = Math.max(state.max, state.active);
    try {
      return await body();
    } finally {
      state.active -= 1;
    }
  };
}

async function tick(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

describe('createConcurrencyPool', function () {
  test('rejects a size below 1', function () {
    expect(() => createConcurrencyPool({ size: 0 })).toThrow(RangeError);
  });

  test('never runs more than `size` thunks at once', async function () {
    const pool = createConcurrencyPool({ size: 3 });
    const state = { active: 0, max: 0 };
    const work = Array.from({ length: 20 }, () =>
      pool.submit(
        counted(state, () => new Promise<void>((r) => setTimeout(r, 5)))
      )
    );
    await Promise.all(work);
    expect(state.max).toBe(3);
    expect(pool.activeCount).toBe(0);
  });

  test('refills one slot on each completion, not in batches', async function () {
    const pool = createConcurrencyPool({ size: 2 });
    const gates = [gate(), gate(), gate(), gate()];
    const started: number[] = [];
    gates.forEach((g, i) =>
      pool.submit(async () => {
        started.push(i);
        await g.wait;
      })
    );
    await tick();
    // Only the first two occupy the pool's two slots.
    expect(started).toEqual([0, 1]);

    // Releasing one admits exactly one more — not both queued thunks.
    gates[0]!.release();
    await tick();
    expect(started).toEqual([0, 1, 2]);

    gates[1]!.release();
    await tick();
    expect(started).toEqual([0, 1, 2, 3]);

    gates[2]!.release();
    gates[3]!.release();
    await pool.onIdle();
  });

  test('size:1 runs strictly sequentially', async function () {
    const pool = createConcurrencyPool({ size: 1 });
    const state = { active: 0, max: 0 };
    const order: number[] = [];
    const work = [0, 1, 2].map((i) =>
      pool.submit(
        counted(state, async () => {
          order.push(i);
          await tick();
        })
      )
    );
    await Promise.all(work);
    expect(order).toEqual([0, 1, 2]);
    expect(state.max).toBe(1);
  });

  test('a throwing thunk frees its slot and the next still runs', async function () {
    const pool = createConcurrencyPool({ size: 1 });
    let caught: unknown;
    const failing = pool.submit(async () => {
      throw new Error('boom');
    });
    await failing.catch((e) => {
      caught = e;
    });
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('boom');

    const ok = await pool.submit(async () => 'ran');
    expect(ok).toBe('ran');
    expect(pool.activeCount).toBe(0);
  });

  test('submit rejection does not affect a sibling submission', async function () {
    const pool = createConcurrencyPool({ size: 2 });
    const failing = pool.submit(async () => {
      throw new Error('one failed');
    });
    const ok = pool.submit(async () => 42);
    await expect(failing).rejects.toThrow('one failed');
    expect(await ok).toBe(42);
  });

  test('onIdle stays pending until active and queued both drain, then re-arms', async function () {
    const pool = createConcurrencyPool({ size: 1 });
    const g = gate();
    pool.submit(async () => {
      await g.wait;
    });
    pool.submit(async () => {});

    let idled = false;
    const idle = pool.onIdle().then(() => {
      idled = true;
    });
    await tick();
    expect(idled).toBe(false);

    g.release();
    await idle;
    expect(idled).toBe(true);

    // Re-arms: a fresh onIdle on an idle pool resolves immediately.
    await pool.onIdle();
  });

  test('whenCapacityAvailable resolves only once a slot frees', async function () {
    const pool = createConcurrencyPool({ size: 1 });
    const g = gate();
    pool.submit(async () => {
      await g.wait;
    });

    let hasCapacity = false;
    const capacity = pool.whenCapacityAvailable().then(() => {
      hasCapacity = true;
    });
    await tick();
    expect(hasCapacity).toBe(false);

    g.release();
    await capacity;
    expect(hasCapacity).toBe(true);
  });
});
