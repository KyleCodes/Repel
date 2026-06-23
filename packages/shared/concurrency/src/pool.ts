// A zero-arg function returning a promise. The pool owns *when* it runs, so
// callers hand work as thunks, not live promises.
export type Thunk<T> = () => Promise<T>;

export interface ConcurrencyPoolConfig {
  // Max handler invocations in flight at once. size:1 runs strictly sequentially.
  size: number;
}

export interface ConcurrencyPool {
  // Run a thunk under the pool's bound. Resolves/rejects with the thunk's own
  // outcome — a rejection here is the thunk's, surfaced to this caller only; it
  // never affects siblings and always frees + refills the slot.
  submit<T>(thunk: Thunk<T>): Promise<T>;
  // Resolves once there is room to admit another thunk (active + queued < size).
  // Lets a producer pace its submissions instead of growing the queue unbounded.
  whenCapacityAvailable(): Promise<void>;
  // Resolves when the pool is fully idle (nothing active, nothing queued).
  // Re-arms: submitting after idle is fine.
  onIdle(): Promise<void>;
  readonly activeCount: number;
  readonly queuedCount: number;
}

// Running work is the count `active`, not a list. The three arrays below hold
// parked resolver callbacks, not work — each is released when its condition
// holds:
//   queue           — thunks submitted while full, awaiting a slot (FIFO).
//                     Calling an entry starts its thunk.
//   capacityWaiters — callers parked in whenCapacityAvailable(); released when
//                     active + queued < size.
//   idleWaiters     — callers parked in onIdle(); released when fully drained.
// Slot lifecycle: submit() runs immediately if a slot is free, else parks on
// `queue`; run() holds the slot and, in finally, releases it and admits the
// next queued thunk. So max in-flight is `size`, size:1 is sequential, and a
// throwing thunk still frees its slot.
export function createConcurrencyPool(
  config: ConcurrencyPoolConfig
): ConcurrencyPool {
  if (config.size < 1) {
    throw new RangeError(`pool size must be >= 1, got ${config.size}`);
  }
  const size = config.size;

  let active = 0;
  const queue: Array<() => void> = [];
  const idleWaiters: Array<() => void> = [];
  const capacityWaiters: Array<() => void> = [];

  function signalIdle(): void {
    if (active === 0 && queue.length === 0) {
      const waiters = idleWaiters.splice(0);
      for (const resolve of waiters) resolve();
    }
  }

  function signalCapacity(): void {
    while (capacityWaiters.length > 0 && active + queue.length < size) {
      capacityWaiters.shift()!();
    }
  }

  // Hold a slot for the thunk; the finally releases it and admits the next
  // queued thunk (or signals drain/capacity). The try/finally is what keeps a
  // throwing thunk from stalling the pool.
  async function run<T>(thunk: Thunk<T>): Promise<T> {
    active += 1;
    try {
      return await thunk();
    } finally {
      active -= 1;
      if (queue.length > 0) {
        queue.shift()!();
      } else {
        signalIdle();
      }
      signalCapacity();
    }
  }

  function submit<T>(thunk: Thunk<T>): Promise<T> {
    if (active < size) {
      return run(thunk);
    }
    return new Promise<T>(function (resolve, reject) {
      queue.push(function () {
        run(thunk).then(resolve, reject);
      });
    });
  }

  function whenCapacityAvailable(): Promise<void> {
    if (active + queue.length < size) return Promise.resolve();
    return new Promise<void>(function (resolve) {
      capacityWaiters.push(resolve);
    });
  }

  function onIdle(): Promise<void> {
    if (active === 0 && queue.length === 0) return Promise.resolve();
    return new Promise<void>(function (resolve) {
      idleWaiters.push(resolve);
    });
  }

  return {
    submit,
    whenCapacityAvailable,
    onIdle,
    get activeCount() {
      return active;
    },
    get queuedCount() {
      return queue.length;
    },
  };
}
