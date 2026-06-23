import type { RunnableApp } from '@repel/backend-runtime/application';
import { startApi } from './router';

// The api's launch contract — the cli's `services run` imports this to boot it.
export const apiApp: RunnableApp = { start: startApi };

// Also a direct entrypoint: `bun run .../api/src/main.ts` boots the api. The
// guard keeps the cli's import of this module side-effect-free (import.meta.main
// is true only when this file is the process entrypoint, false when imported).
if (import.meta.main) {
  apiApp.start().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
