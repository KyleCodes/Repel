import { CamelCasePlugin, Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { DB } from './generated.ts';

// Builds a fresh Kysely instance over a new pg Pool. Normal app code should
// not call this directly — use getDb() from runtime.ts to get the lazily
// instantiated singleton. This factory exists so tests (or CLI scripts that
// need to tear down explicitly) can construct their own instance.
export function makeDb(): Kysely<DB> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  return new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString: url }),
    }),
    plugins: [new CamelCasePlugin()],
  });
}
