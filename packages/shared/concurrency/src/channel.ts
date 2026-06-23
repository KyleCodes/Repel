// A minimal unbounded async queue. Producers push values (never blocks) and
// close (or fail) when done; a single consumer iterates with `for await`. When
// the consumer is waiting and the buffer is empty, the next push/close/fail wakes
// it. Pure data structure — no pool, no timers, no work awareness.
export interface Channel<T> {
  // Enqueue a value. Never blocks — the queue is unbounded.
  push(value: T): void;
  // No more values. Iteration ends once the buffer drains.
  close(): void;
  // Iteration throws this once the buffer drains. First failure wins.
  fail(error: unknown): void;
  [Symbol.asyncIterator](): AsyncIterator<T>;
}

export function createChannel<T>(): Channel<T> {
  const buffer: T[] = [];
  let closed = false;
  let failure: { error: unknown } | null = null;
  // The parked consumer's resolver, if it is currently awaiting a value.
  let wake: (() => void) | null = null;

  function bump(): void {
    const w = wake;
    wake = null;
    w?.();
  }

  return {
    push(value: T): void {
      buffer.push(value);
      bump();
    },
    close(): void {
      closed = true;
      bump();
    },
    fail(error: unknown): void {
      failure ??= { error };
      bump();
    },
    async *[Symbol.asyncIterator](): AsyncIterator<T> {
      while (true) {
        if (buffer.length > 0) {
          yield buffer.shift()!;
          continue;
        }
        // Buffered values drain before a close/fail takes effect.
        if (failure) throw failure.error;
        if (closed) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
  };
}
