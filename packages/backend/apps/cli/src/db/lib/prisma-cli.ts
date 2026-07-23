import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DB_PACKAGE_DIR } from './migrations';

// Shells the Prisma CLI under Node — never `bun x`: the CLI's node shebang
// plus Bun's shim have a history of silent hangs (prisma/prisma#26560), so
// Node is the supported runtime even though the app itself runs on Bun.
//
// The binary is the db package's own devDependency (bun's isolated installs
// put it in that package's node_modules/.bin), and cwd is pinned to the db
// package so prisma.config.ts / prisma/schema.prisma resolve regardless of
// where the repel CLI was invoked. DATABASE_URL must be in the child env —
// prisma.config.ts loads env('DATABASE_URL') at config-parse time, even for
// commands that never connect.
export function runPrismaCli(
  args: string[],
  env: { databaseUrl: string }
): string {
  const prismaBin = join(DB_PACKAGE_DIR, 'node_modules/.bin/prisma');
  if (!existsSync(prismaBin)) {
    throw new Error(
      `prisma binary not found at ${prismaBin} — run \`bun install\`.`
    );
  }
  return execFileSync('node', [prismaBin, ...args], {
    cwd: DB_PACKAGE_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, DATABASE_URL: env.databaseUrl },
  });
}
