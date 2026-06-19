import { startApi } from './router';

startApi().catch((err) => {
  console.error(err);
  process.exit(1);
});
