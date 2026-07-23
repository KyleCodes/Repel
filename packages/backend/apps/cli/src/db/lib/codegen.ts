import { logger } from '@repel/logger/logger';
import { readDatabaseUrlFromEnvLocal } from './env-local';
import { DB_PACKAGE_DIR } from './migrations';
import { runPrismaCli } from './prisma-cli';

// Regenerates the committed Prisma client (libs/db/src/prisma/) from
// prisma/schema.prisma. Unlike the kysely-codegen predecessor this reads the
// schema file, not the live database — typegen no longer depends on DB state.
// DATABASE_URL is still injected because prisma.config.ts resolves it at
// config-parse time; no connection is opened.
//
// Called as a post-step of `repel db migrations up` so the committed client
// tracks schema changes, and exposed directly as `repel db codegen`.
export async function runCodegen(): Promise<void> {
  runPrismaCli(['generate'], { databaseUrl: readDatabaseUrlFromEnvLocal() });
  logger.info('codegen: regenerated', {
    dir: `${DB_PACKAGE_DIR}/src/prisma`,
  });
}
