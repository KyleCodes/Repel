import { startApi } from './api/router.ts';

type Mode = 'all' | 'api' | 'worker';

async function main() {
  const mode = (process.env.MODE ?? 'all') as Mode;

  console.log(`Starting in mode: ${mode}`);

  // Stub — components will be wired in as they're built.
  // The worker process runs all queue consumers (sync, process, ...) in-process;
  // per-queue tuning is a parameter, not a separate entrypoint.
  const components: Record<Mode, () => Promise<void>> = {
    api: startApi,
    worker: async () => {
      console.log('Worker not yet implemented');
    },
    all: async () => {
      await Promise.all([components.api(), components.worker()]);
    },
  };

  await components[mode]();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
