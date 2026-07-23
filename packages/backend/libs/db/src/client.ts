import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { getRequiredEnvVar } from '@repel/backend-env/accessors';
import { PrismaClient } from './prisma/client';

// Builds a fresh PrismaClient over a new pg Pool. Normal app code should
// not call this directly — use getDb() from runtime.ts to get the lazily
// instantiated singleton. This factory exists so tests (or CLI scripts that
// need to tear down explicitly) can construct their own instance.
//
// The Pool is constructed here (rather than letting the adapter build one
// from a connection string) so pool ownership stays explicit and tunable.
export function makeDb(): PrismaClient {
  const url = getRequiredEnvVar('DATABASE_URL');

  const adapter = new PrismaPg(new Pool({ connectionString: url }));
  return new PrismaClient({ adapter });
}
