// Bun auto-loads .env.local at startup, so DATABASE_URL is already on
// process.env by the time CLI handlers run. This helper just surfaces a
// clear error when it's missing — typical cause: `repel db clone` not run yet.
export function readDatabaseUrlFromEnvLocal(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL not set — run `repel db clone` first to write .env.local'
    );
  }
  return url;
}
