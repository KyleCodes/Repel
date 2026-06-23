import { PermanentHandlerError } from '../error';
import type { ClaimedJob, Transport } from '../persistence/service';
import { pgTransport } from '../persistence/service';
import type { ConsumerConfig, ConsumerHandle, QueueHandler } from '../types';
import { backoffMs } from './backoff';

const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_CONCURRENCY = 1;
const DEFAULT_REAP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_COMPLETED_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function defaultConsumerId(): string {
  return `consumer-${process.pid}`;
}

// Bind a handler to a topic and return its control handle. The consumer polls
// the topic on a self-pacing recursive timer, claims up to `concurrency` due
// envelopes per tick, and runs the handler on each. A claimed job's `attempts`
// already counts the current delivery (incremented at claim), so a handler
// failure reschedules while attempts < maxAttempts and dead-letters once they
// are exhausted (or immediately on PermanentHandlerError). A second, slower
// timer sweeps old completed rows so the table does not grow without bound.
// The transport is injectable so the runtime is testable without Postgres.
export function consume(
  topic: string,
  handler: QueueHandler,
  config: ConsumerConfig = {},
  transport: Transport = pgTransport
): ConsumerHandle {
  const consumerId = config.consumerId ?? defaultConsumerId();
  const pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const concurrency = config.concurrency ?? DEFAULT_CONCURRENCY;
  const reapIntervalMs = config.reapIntervalMs ?? DEFAULT_REAP_INTERVAL_MS;
  const completedTtlMs = config.completedTtlMs ?? DEFAULT_COMPLETED_TTL_MS;

  let running = false;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let reapTimer: ReturnType<typeof setTimeout> | undefined;
  const inFlight = new Set<Promise<void>>();

  // Track an in-flight handler promise so stop() can drain it, self-removing
  // when it settles.
  function track(p: Promise<void>): Promise<void> {
    const tracked = p.finally(() => {
      inFlight.delete(tracked);
    });
    inFlight.add(tracked);
    return tracked;
  }

  async function process(job: ClaimedJob): Promise<void> {
    try {
      await handler(job.envelope);
      await transport.complete(job.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const permanent = err instanceof PermanentHandlerError;
      if (!permanent && job.attempts < job.maxAttempts) {
        await transport.reschedule(job.id, backoffMs(job.attempts), message);
      } else {
        console.warn(
          `queue: dead-lettered ${job.id} on "${topic}" after ${job.attempts} attempt(s): ${message}`
        );
        await transport.deadLetter(job.id, message);
      }
    }
  }

  function scheduleNextPoll(delayMs: number): void {
    if (!running) return;
    pollTimer = setTimeout(() => {
      void poll();
    }, delayMs);
  }

  async function poll(): Promise<void> {
    if (!running) return;
    try {
      const claimed = await transport.claim(topic, consumerId, concurrency);
      const work = claimed.map((job) => track(process(job)));
      await Promise.allSettled(work);
    } finally {
      scheduleNextPoll(pollIntervalMs);
    }
  }

  function scheduleNextReap(): void {
    if (!running) return;
    reapTimer = setTimeout(() => {
      void reap();
    }, reapIntervalMs);
  }

  async function reap(): Promise<void> {
    if (!running) return;
    try {
      const reaped = await transport.reap(completedTtlMs);
      if (reaped > 0) {
        console.log(`queue: reaped ${reaped} completed job(s) from "${topic}"`);
      }
    } finally {
      scheduleNextReap();
    }
  }

  return {
    // Resolve-when-ready: install the poll + reap loops and return. The loops
    // keep the process alive; this promise is the launcher's "consumer is up"
    // barrier. The first reap fires after one interval, not at boot.
    async start(): Promise<void> {
      if (running) return;
      running = true;
      scheduleNextPoll(0);
      scheduleNextReap();
    },

    // Stop claiming new work and wait for in-flight handlers to settle. The
    // reaper is idempotent and side-effect-free, so its timer is simply cleared
    // (not drained). Resolves once in-flight handlers drain.
    async stop(): Promise<void> {
      running = false;
      if (pollTimer !== undefined) {
        clearTimeout(pollTimer);
        pollTimer = undefined;
      }
      if (reapTimer !== undefined) {
        clearTimeout(reapTimer);
        reapTimer = undefined;
      }
      await Promise.allSettled([...inFlight]);
    },
  };
}
