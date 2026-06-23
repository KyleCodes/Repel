import { consume as defaultConsume } from '@repel/backend-queue/client';
import type { RunnableApp } from '@repel/backend-runtime/application';
import { syncHandler } from './handler';

// The topic this worker consumes. The CLI enqueuer writes to the same topic
// (REP-57); keep the two in sync.
const SYNC_TOPIC = 'sync';

// Injectable seam so the app can be unit-tested without a real queue/poll loop.
export interface SyncWorkerDeps {
  consume?: typeof defaultConsume;
}

// Build the sync-worker's RunnableApp: a libs/queue consumer bound to the `sync`
// topic. start() installs the poll loop (resolve-when-ready); stop() drains
// in-flight handlers before resolving — this is the first app to implement the
// optional RunnableApp.stop() (REP-64 reserved it; REP-58 wired the launcher's
// drainAndClose to call it).
export function createSyncWorkerApp(deps: SyncWorkerDeps = {}): RunnableApp {
  const consume = deps.consume ?? defaultConsume;
  const consumer = consume(SYNC_TOPIC, syncHandler);

  return {
    start: () => consumer.start(),
    stop: () => consumer.stop(),
  };
}
