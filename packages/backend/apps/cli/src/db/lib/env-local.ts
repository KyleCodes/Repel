import { getRequiredEnvVar } from '@repel/backend-env/accessors';

// Bun auto-loads .env.local at startup, so DATABASE_URL is already on
// process.env by the time CLI handlers run. This helper just surfaces a
// clear error when it's missing — typical cause: `repel db clone` not run yet.
export function readDatabaseUrlFromEnvLocal(): string {
  return getRequiredEnvVar(
    'DATABASE_URL',
    'DATABASE_URL not set — run `repel db clone` first to write .env.local'
  );
}
