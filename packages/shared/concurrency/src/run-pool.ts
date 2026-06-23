import { createConcurrencyPool } from './pool';

// A bounded-concurrency Promise.allSettled(items.map(fn)): runs fn over items
// with at most `size` concurrent invocations and returns the results in INPUT
// order. Never rejects — each item's rejection becomes a 'rejected' settled
// entry, preserving allSettled's isolation.
export async function runPool<I, O>(
  items: readonly I[],
  size: number,
  fn: (item: I, index: number) => Promise<O>
): Promise<PromiseSettledResult<O>[]> {
  const pool = createConcurrencyPool({ size });
  // Pre-sized; each .then writes its fixed index as that item settles, so it
  // fills in completion order but stays input-indexed.
  const results = new Array<PromiseSettledResult<O>>(items.length);
  const submissions = items.map(function (item, index) {
    return pool
      .submit(() => fn(item, index))
      .then(
        function (value) {
          results[index] = { status: 'fulfilled', value };
        },
        function (reason) {
          results[index] = { status: 'rejected', reason };
        }
      );
  });
  await Promise.all(submissions);
  return results;
}
