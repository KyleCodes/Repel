import { startApi } from './router.ts';

startApi().catch((err) => {
  console.error(err);
  process.exit(1);
});
