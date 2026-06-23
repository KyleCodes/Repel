import type { RunnableApp } from '@repel/backend-runtime/application';
import { createSyncWorkerApp } from './start';

// The sync-worker's launch contract — the cli's `services run sync-worker`
// imports this to boot it (and drains it via stop() on shutdown).
export const syncWorkerApp: RunnableApp = createSyncWorkerApp();

// Also a direct entrypoint: `bun run .../sync-worker/src/main.ts` boots it. The
// guard keeps the cli's import of this module side-effect-free (import.meta.main
// is true only when this file is the process entrypoint, false when imported).
if (import.meta.main) {
  syncWorkerApp.start().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
