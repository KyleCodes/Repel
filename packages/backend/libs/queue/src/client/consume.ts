import { boundedConcurrencyPoolStream } from '@repel/concurrency';
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

// Bind a handler to a topic and return its control handle. Claimed jobs are
// expressed as a lazy source and streamed through a bounded pool that keeps
// `concurrency` handler invocations in flight, refilling each slot as it frees.
// The source claims `batchSize` rows per DB round-trip (decoupled from the pool
// size) and backs off `pollIntervalMs` whenever it does not get a full batch —
// a partial/empty batch means the topic is drained, so spinning would just hammer
// it. The stream's capacity gate bounds the in-memory backlog: the source is
// suspended whenever the pool is saturated, so it never claims ahead. A claimed
// job's `attempts` already counts the current delivery, so a handler failure
// reschedules while attempts < maxAttempts and dead-letters once exhausted (or
// immediately on PermanentHandlerError). A second, slower timer sweeps old
// completed rows. The transport is injectable so the runtime is testable without
// Postgres.
export function consume(
  topic: string,
  handler: QueueHandler,
  config: ConsumerConfig = {},
  transport: Transport = pgTransport
): ConsumerHandle {
  const consumerId = config.consumerId ?? defaultConsumerId();
  const pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const concurrency = config.concurrency ?? DEFAULT_CONCURRENCY;
  const batchSize = config.batchSize ?? concurrency;
  const reapIntervalMs = config.reapIntervalMs ?? DEFAULT_REAP_INTERVAL_MS;
  const completedTtlMs = config.completedTtlMs ?? DEFAULT_COMPLETED_TTL_MS;

  let running = false;
  let reapTimer: ReturnType<typeof setTimeout> | undefined;
  let consuming: Promise<void> | undefined;
  // Resolves when stop() is called, so a mid-backoff sleep ends promptly instead
  // of running out the full interval.
  let signalStop: (() => void) | undefined;

  function delay(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      signalStop = () => {
        clearTimeout(timer);
        resolve();
      };
    });
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

  // The lazy claimed-jobs source. The stream pulls one job per free pool slot, so
  // claims are paced by the pool. A full batch loops immediately; a partial or
  // empty batch backs off (the topic is drained).
  async function* claimedJobs(): AsyncGenerator<ClaimedJob> {
    while (running) {
      const claimed = await transport.claim(topic, consumerId, batchSize);
      for (const job of claimed) yield job;
      if (claimed.length < batchSize) await delay(pollIntervalMs);
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
    // Resolve-when-ready: install the claim stream + reap loop and return. The
    // stream keeps the process alive; this promise is the launcher's "consumer is
    // up" barrier. The first reap fires after one interval, not at boot.
    async start(): Promise<void> {
      if (running) return;
      running = true;
      // process() never throws (it maps failures to reschedule/deadLetter), so
      // the per-item results are uninteresting — just exhaust the stream.
      consuming = (async () => {
        for await (const _ of boundedConcurrencyPoolStream(
          claimedJobs(),
          concurrency,
          process
        )) {
          // drained for its side effects
        }
      })();
      scheduleNextReap();
    },

    // Stop claiming new work and wait for in-flight handlers to drain. Flipping
    // `running` ends the source after its current claim; `signalStop` ends a
    // mid-backoff sleep promptly. The reaper is side-effect-free, so its timer is
    // simply cleared. Resolves once the stream drains.
    async stop(): Promise<void> {
      running = false;
      signalStop?.();
      if (reapTimer !== undefined) {
        clearTimeout(reapTimer);
        reapTimer = undefined;
      }
      await consuming;
    },
  };
}
