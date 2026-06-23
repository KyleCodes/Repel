import { describe, expect, test } from 'bun:test';
import { PermanentHandlerError } from '../../error';
import type { ClaimedJob, Transport } from '../../persistence/transport';
import type { Envelope } from '../../types';
import { consume } from '../consume';

function envelope(payload: unknown): Envelope {
  return { topic: 'test', orgId: 'org-1', payload };
}

// An in-memory transport: claim() hands out queued jobs oldest-first up to the
// limit; complete/reschedule/deadLetter are recorded. reschedule re-queues the
// job with attempts already incremented (claim does that in the real transport,
// so the fake mirrors it) so retry-then-dead-letter can be exercised end to end.
class FakeTransport implements Transport {
  queue: ClaimedJob[] = [];
  completed: string[] = [];
  rescheduled: Array<{ id: string; backoffMs: number; error: string }> = [];
  deadLettered: Array<{ id: string; error: string }> = [];
  claimCalls: Array<{ limit: number }> = [];

  async enqueue() {
    return undefined;
  }

  async claim(_topic: string, _consumerId: string, limit: number) {
    this.claimCalls.push({ limit });
    return this.queue.splice(0, limit);
  }

  async complete(id: string) {
    this.completed.push(id);
  }

  async reschedule(id: string, backoffMs: number, error: string) {
    this.rescheduled.push({ id, backoffMs, error });
    const job = this.jobsById.get(id);
    if (job) {
      // Mirror the real transport: claim() increments attempts, so the re-queued
      // delivery carries attempts+1. Persist it so the next reschedule advances.
      const next = { ...job, attempts: job.attempts + 1 };
      this.jobsById.set(id, next);
      this.queue.push(next);
    }
  }

  async deadLetter(id: string, error: string) {
    this.deadLettered.push({ id, error });
  }

  jobsById = new Map<string, ClaimedJob>();
  seed(jobs: ClaimedJob[]) {
    for (const j of jobs) this.jobsById.set(j.id, j);
    this.queue.push(...jobs);
  }
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
    const t = new FakeTransport();
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
    const t = new FakeTransport();
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

  test('a failing handler reschedules until attempts exhaust, then dead-letters', async function () {
    const t = new FakeTransport();
    // attempts starts at 1 (this delivery), maxAttempts 3: expect reschedule at
    // attempts 1 and 2, dead-letter at attempts 3.
    t.seed([job('x', 'boom', 1, 3)]);

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

    expect(t.rescheduled.map((r) => r.id)).toEqual(['x', 'x']);
    expect(t.rescheduled[0]!.error).toBe('handler failed');
    expect(t.deadLettered[0]).toEqual({ id: 'x', error: 'handler failed' });
    expect(t.completed).toHaveLength(0);
  });

  test('PermanentHandlerError dead-letters immediately, skipping retries', async function () {
    const t = new FakeTransport();
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
    const t = new FakeTransport();
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
});
