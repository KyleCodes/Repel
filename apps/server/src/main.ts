import { startApi } from './api/router.js';

type Mode = 'all' | 'api' | 'worker' | 'sync';

async function main() {
  const mode = (process.env.MODE ?? 'all') as Mode;

  console.log(`Starting in mode: ${mode}`);

  // Stub — components will be wired in as they're built
  const components: Record<Mode, () => Promise<void>> = {
    api: startApi,
    worker: async () => {
      console.log('Worker not yet implemented');
    },
    sync: async () => {
      console.log('Sync not yet implemented');
    },
    all: async () => {
      await Promise.all([
        components.api(),
        components.worker(),
        components.sync(),
      ]);
    },
  };

  await components[mode]();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
