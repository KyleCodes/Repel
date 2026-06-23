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
// in-flight handlers before resolving.
export function createSyncWorkerApp(deps: SyncWorkerDeps = {}): RunnableApp {
  const consume = deps.consume ?? defaultConsume;
  const consumer = consume(SYNC_TOPIC, syncHandler);

  return {
    start: () => consumer.start(),
    stop: () => consumer.stop(),
  };
}

// The sync-worker's launch contract — the cli's `services run sync-worker`
// imports this to boot it (and drains it via stop() on shutdown).
export const syncWorkerApp: RunnableApp = createSyncWorkerApp();

// Also a direct entrypoint: `bun run .../sync-worker/src/start.ts` boots it. The
// guard keeps the cli's import of this module side-effect-free (import.meta.main
// is true only when this file is the process entrypoint, false when imported).
if (import.meta.main) {
  syncWorkerApp.start().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
