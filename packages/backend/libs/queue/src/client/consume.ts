import { PermanentHandlerError } from '../error';
import { type Transport, pgTransport } from '../persistence/transport';
import type { ClaimedJob } from '../persistence/transport';
import type { ConsumerConfig, ConsumerHandle, QueueHandler } from '../types';
import { backoffMs } from './backoff';

const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_CONCURRENCY = 1;

function defaultConsumerId(): string {
  return `consumer-${process.pid}`;
}

// The consumer runtime. Polls a topic on a self-pacing recursive timer, claims
// up to `concurrency` due envelopes per tick, and runs the handler on each. A
// claimed job's `attempts` already counts the current delivery (incremented at
// claim), so a handler failure reschedules while attempts < maxAttempts and
// dead-letters once they are exhausted (or immediately on PermanentHandlerError).
// The transport is injectable so the runtime is unit-testable without Postgres.
class Consumer implements ConsumerHandle {
  private running = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly inFlight = new Set<Promise<void>>();
  private readonly consumerId: string;
  private readonly pollIntervalMs: number;
  private readonly concurrency: number;

  constructor(
    private readonly topic: string,
    private readonly handler: QueueHandler,
    private readonly transport: Transport,
    config: ConsumerConfig
  ) {
    this.consumerId = config.consumerId ?? defaultConsumerId();
    this.pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.concurrency = config.concurrency ?? DEFAULT_CONCURRENCY;
  }

  // Resolve-when-ready: install the poll loop and return. The loop keeps the
  // process alive; this promise is the launcher's "consumer is up" barrier.
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.scheduleNextPoll(0);
  }

  // Stop claiming new work and wait for in-flight handlers to settle. Resolves
  // only once the queue is drained, so a launcher can await a clean shutdown.
  async stop(): Promise<void> {
    this.running = false;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await Promise.allSettled([...this.inFlight]);
  }

  private scheduleNextPoll(delayMs: number): void {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      void this.poll();
    }, delayMs);
  }

  private async poll(): Promise<void> {
    if (!this.running) return;
    let claimed: ClaimedJob[] = [];
    try {
      claimed = await this.transport.claim(
        this.topic,
        this.consumerId,
        this.concurrency
      );
      const work = claimed.map((job) => this.track(this.process(job)));
      await Promise.allSettled(work);
    } finally {
      this.scheduleNextPoll(this.pollIntervalMs);
    }
  }

  private async process(job: ClaimedJob): Promise<void> {
    try {
      await this.handler(job.envelope);
      await this.transport.complete(job.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const permanent = err instanceof PermanentHandlerError;
      if (!permanent && job.attempts < job.maxAttempts) {
        await this.transport.reschedule(
          job.id,
          backoffMs(job.attempts),
          message
        );
      } else {
        await this.transport.deadLetter(job.id, message);
      }
    }
  }

  // Track an in-flight handler promise so stop() can drain it, self-removing
  // when it settles.
  private track(p: Promise<void>): Promise<void> {
    const tracked = p.finally(() => {
      this.inFlight.delete(tracked);
    });
    this.inFlight.add(tracked);
    return tracked;
  }
}

// Bind a handler to a topic and return its control handle. The Postgres
// transport is the default; tests inject a fake.
export function consume(
  topic: string,
  handler: QueueHandler,
  config: ConsumerConfig = {},
  transport: Transport = pgTransport
): ConsumerHandle {
  return new Consumer(topic, handler, transport, config);
}
