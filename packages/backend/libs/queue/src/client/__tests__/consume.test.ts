import { describe, expect, spyOn, test } from 'bun:test';
import { PermanentHandlerError } from '../../error';
import type { ClaimedJob, Transport } from '../../persistence/service';
import type { Envelope } from '../../types';
import { consume } from '../consume';

function envelope(payload: unknown): Envelope {
  return { topic: 'test', orgId: 'org-1', payload };
}

// An in-memory transport (a struct adhering to Transport, no class). claim()
// hands out queued jobs oldest-first up to the limit; complete/reschedule/
// deadLetter/reap are recorded. reschedule re-queues the job with attempts
// already incremented (claim does that in the real transport, so the fake
// mirrors it) so retry-then-dead-letter can be exercised end to end.
interface FakeTransport extends Transport {
  queue: ClaimedJob[];
  completed: string[];
  rescheduled: Array<{ id: string; backoffMs: number; error: string }>;
  deadLettered: Array<{ id: string; error: string }>;
  claimCalls: Array<{ limit: number }>;
  reapCalls: number[];
  reapReturns: number;
  seed(jobs: ClaimedJob[]): void;
}

function makeFakeTransport(): FakeTransport {
  const jobsById = new Map<string, ClaimedJob>();
  const t: FakeTransport = {
    queue: [],
    completed: [],
    rescheduled: [],
    deadLettered: [],
    claimCalls: [],
    reapCalls: [],
    reapReturns: 0,
    async enqueue() {
      return undefined;
    },
    async claim(_topic: string, _consumerId: string, limit: number) {
      t.claimCalls.push({ limit });
      return t.queue.splice(0, limit);
    },
    async complete(id: string) {
      t.completed.push(id);
    },
    async reschedule(id: string, backoffMs: number, error: string) {
      t.rescheduled.push({ id, backoffMs, error });
      const job = jobsById.get(id);
      if (job) {
        const next = { ...job, attempts: job.attempts + 1 };
        jobsById.set(id, next);
        t.queue.push(next);
      }
    },
    async deadLetter(id: string, error: string) {
      t.deadLettered.push({ id, error });
    },
    async reap(ttlMs: number) {
      t.reapCalls.push(ttlMs);
      return t.reapReturns;
    },
    seed(jobs: ClaimedJob[]) {
      for (const j of jobs) jobsById.set(j.id, j);
      t.queue.push(...jobs);
    },
  };
  return t;
}

function job(
  id: string,
  payload: unknown,
  attempts = 1,
  maxAttempts = 3
): ClaimedJob {
  return { id, envelope: envelope(payload), attempts, maxAttempts };
}

// Spin until `predicate` holds or a timeout elapses, polling faster than the
// consumer's own interval so assertions don't race the loop.
async function waitFor(
  predicate: () => boolean,
  timeoutMs = 1000
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 2));
  }
}

describe('consume', function () {
  test('claims and completes jobs FIFO within a topic', async function () {
    const t = makeFakeTransport();
    const seen: unknown[] = [];
    t.seed([job('a', 1), job('b', 2), job('c', 3)]);

    const consumer = consume(
      'test',
      async (env) => {
        seen.push(env.payload);
      },
      { pollIntervalMs: 5, concurrency: 1 },
      t
    );
    await consumer.start();
    await waitFor(() => t.completed.length === 3);
    await consumer.stop();

    expect(seen).toEqual([1, 2, 3]);
    expect(t.completed).toEqual(['a', 'b', 'c']);
  });

  test('honors concurrency by claiming a batch of that size', async function () {
    const t = makeFakeTransport();
    t.seed([job('a', 1), job('b', 2), job('c', 3)]);

    const consumer = consume(
      'test',
      async () => {},
      { pollIntervalMs: 5, concurrency: 3 },
      t
    );
    await consumer.start();
    await waitFor(() => t.completed.length === 3);
    await consumer.stop();

    expect(t.claimCalls[0]!.limit).toBe(3);
    expect(t.completed.sort()).toEqual(['a', 'b', 'c']);
  });

  test('claims batchSize rows per round-trip but caps handlers at concurrency', async function () {
    const t = makeFakeTransport();
    t.seed([job('a', 1), job('b', 2), job('c', 3), job('d', 4), job('e', 5)]);

    let active = 0;
    let maxActive = 0;
    const consumer = consume(
      'test',
      async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 5));
        active -= 1;
      },
      { pollIntervalMs: 5, concurrency: 2, batchSize: 5 },
      t
    );
    await consumer.start();
    await waitFor(() => t.completed.length === 5);
    await consumer.stop();

    // One DB round-trip claimed all five rows...
    expect(t.claimCalls[0]!.limit).toBe(5);
    // ...but no more than two handlers ever ran at once.
    expect(maxActive).toBe(2);
    expect(t.completed.sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  test('refilling keeps the pool saturated across batches', async function () {
    const t = makeFakeTransport();
    t.seed(Array.from({ length: 10 }, (_, i) => job(`j${i}`, i)));

    let active = 0;
    let maxActive = 0;
    const consumer = consume(
      'test',
      async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 3));
        active -= 1;
      },
      { pollIntervalMs: 5, concurrency: 3, batchSize: 3 },
      t
    );
    await consumer.start();
    await waitFor(() => t.completed.length === 10);
    await consumer.stop();

    expect(maxActive).toBe(3);
    expect(t.completed).toHaveLength(10);
  });

  test('a failing handler reschedules until attempts exhaust, then dead-letters (and warns)', async function () {
    const t = makeFakeTransport();
    // attempts starts at 1 (this delivery), maxAttempts 3: expect reschedule at
    // attempts 1 and 2, dead-letter at attempts 3.
    t.seed([job('x', 'boom', 1, 3)]);
    const warn = spyOn(console, 'warn').mockReturnValue(undefined);
    let warned: string[] = [];

    try {
      const consumer = consume(
        'test',
        async () => {
          throw new Error('handler failed');
        },
        { pollIntervalMs: 5, concurrency: 1 },
        t
      );
      await consumer.start();
      await waitFor(() => t.deadLettered.length === 1);
      await consumer.stop();
      // Capture before restore — mockRestore() clears the recorded calls.
      warned = warn.mock.calls.map((c) => String(c[0]));
    } finally {
      warn.mockRestore();
    }

    expect(t.rescheduled.map((r) => r.id)).toEqual(['x', 'x']);
    expect(t.rescheduled[0]!.error).toBe('handler failed');
    expect(t.deadLettered[0]).toEqual({ id: 'x', error: 'handler failed' });
    expect(t.completed).toHaveLength(0);
    // The dead-letter path warns with the job id and the error.
    expect(warned.some((line) => line.includes('dead-lettered x'))).toBe(true);
    expect(warned.some((line) => line.includes('handler failed'))).toBe(true);
  });

  test('PermanentHandlerError dead-letters immediately, skipping retries', async function () {
    const t = makeFakeTransport();
    t.seed([job('x', 'nope', 1, 5)]);

    const consumer = consume(
      'test',
      async () => {
        throw new PermanentHandlerError('do not retry');
      },
      { pollIntervalMs: 5, concurrency: 1 },
      t
    );
    await consumer.start();
    await waitFor(() => t.deadLettered.length === 1);
    await consumer.stop();

    expect(t.rescheduled).toHaveLength(0);
    expect(t.deadLettered[0]).toEqual({ id: 'x', error: 'do not retry' });
  });

  test('stop() drains an in-flight handler before resolving', async function () {
    const t = makeFakeTransport();
    t.seed([job('slow', 1)]);

    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let handlerDone = false;

    const consumer = consume(
      'test',
      async () => {
        await gate;
        handlerDone = true;
      },
      { pollIntervalMs: 5, concurrency: 1 },
      t
    );
    await consumer.start();
    // Wait until the handler is in-flight (claimed, awaiting the gate).
    await waitFor(() => t.claimCalls.length > 0);

    let stopResolved = false;
    const stopping = consumer.stop().then(() => {
      stopResolved = true;
    });

    // stop() must not resolve while the handler is still gated.
    await new Promise((r) => setTimeout(r, 20));
    expect(stopResolved).toBe(false);
    expect(handlerDone).toBe(false);

    release();
    await stopping;
    expect(handlerDone).toBe(true);
    expect(stopResolved).toBe(true);
  });

  test('stop() ends a consumer idling mid-backoff without waiting the full interval', async function () {
    const t = makeFakeTransport(); // empty queue → the source backs off immediately
    const consumer = consume(
      'test',
      async () => {},
      { pollIntervalMs: 100_000, concurrency: 1 }, // a backoff far longer than the test
      t
    );
    await consumer.start();
    await waitFor(() => t.claimCalls.length > 0); // it claimed once, got nothing, is now sleeping

    const start = Date.now();
    await consumer.stop(); // must not wait out the 100s backoff
    expect(Date.now() - start).toBeLessThan(1000);
  });
});

describe('consume — reaper', function () {
  test('sweeps completed jobs on its own timer with the configured TTL, and logs when rows are reaped', async function () {
    const t = makeFakeTransport();
    t.reapReturns = 3;
    const log = spyOn(console, 'log').mockReturnValue(undefined);
    let logged: string[] = [];

    try {
      const consumer = consume(
        'test',
        async () => {},
        {
          pollIntervalMs: 100_000, // keep the poll loop out of the way
          reapIntervalMs: 5,
          completedTtlMs: 1234,
        },
        t
      );
      await consumer.start();
      await waitFor(() => t.reapCalls.length > 0);
      await consumer.stop();
      // Capture before restore — mockRestore() clears the recorded calls.
      logged = log.mock.calls.map((c) => String(c[0]));
    } finally {
      log.mockRestore();
    }

    // The sweep ran with the configured TTL.
    expect(t.reapCalls[0]).toBe(1234);
    // A non-zero reap is logged.
    expect(logged.some((line) => line.includes('reaped 3 completed'))).toBe(
      true
    );
  });

  test('stop() halts the reaper (no sweep after stop)', async function () {
    const t = makeFakeTransport();

    const consumer = consume(
      'test',
      async () => {},
      { pollIntervalMs: 100_000, reapIntervalMs: 5 },
      t
    );
    await consumer.start();
    await waitFor(() => t.reapCalls.length > 0);
    await consumer.stop();

    const countAtStop = t.reapCalls.length;
    // Wait several reap intervals; the count must not grow after stop().
    await new Promise((r) => setTimeout(r, 30));
    expect(t.reapCalls.length).toBe(countAtStop);
  });
});
