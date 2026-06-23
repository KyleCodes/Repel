import { createChannel } from './channel';
import { createConcurrencyPool } from './pool';

// Stream `fn` over `source` with at most `size` concurrent invocations, yielding
// each result as it settles (completion order, not source order). Composition
// only: a pool bounds concurrency, a channel carries results out. The source is
// pulled lazily — one item per free slot — so it never outruns the pool, which
// bounds the in-memory backlog. The first rejection (from `fn` or the source)
// fails the stream; in-flight siblings settle and are dropped (the pool has no
// cancellation). Breaking out of the iteration early stops the producer.
export async function* boundedConcurrencyPoolStream<I, O>(
  source: AsyncIterable<I> | Iterable<I>,
  size: number,
  fn: (item: I) => Promise<O>
): AsyncGenerator<O> {
  const pool = createConcurrencyPool({ size });
  const out = createChannel<O>();
  let cancelled = false;

  const producer = (async () => {
    try {
      for await (const item of source) {
        if (cancelled) break;
        // Suspends here while the pool is saturated — the backpressure that
        // keeps the source from running ahead and piling work in memory.
        await pool.whenCapacityAvailable();
        if (cancelled) break;
        void pool
          .submit(() => fn(item))
          .then(
            (value) => out.push(value),
            (error) => out.fail(error)
          );
      }
      await pool.onIdle();
      out.close();
    } catch (error) {
      out.fail(error);
    }
  })();

  try {
    yield* out;
  } finally {
    // Early break/return: stop pulling + submitting, then let in-flight settle
    // so no rejection leaks unhandled.
    cancelled = true;
    await producer;
  }
}
