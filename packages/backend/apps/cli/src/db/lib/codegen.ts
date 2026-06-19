import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { readDatabaseUrlFromEnvLocal } from './env-local';
import { MIGRATIONS_DIR } from './migrations';

// Absolute path to the kysely-codegen output file. Resolved as a sibling of
// the migrations directory (both live in infra/db/), so it stays correct
// regardless of process.cwd() — same repo-root-anchored strategy as
// MIGRATIONS_DIR. See infra/db/types.ts for the hand-written Db/Tx aliases
// that re-export the `DB` interface this file generates.
export const GENERATED_TYPES_FILE = join(
  dirname(MIGRATIONS_DIR),
  'generated.ts'
);

// Regenerates infra/db/generated.ts from the live database schema by shelling
// out to kysely-codegen. Mirrors how migrations/handler.ts shells `bun x
// node-pg-migrate` — kysely-codegen has no stable programmatic entrypoint, so
// the CLI is the supported surface.
//
// Called as a post-step of every migration command (up/down/nuke) so the
// generated types can never drift from the schema, and exposed directly as
// `repel db codegen` for manual runs. Options are passed as explicit flags
// (not relying on .kysely-codegenrc.json discovery) to stay cwd-independent.
//
// kysely-codegen's output formatting differs from the repo's prettier config,
// so the file is formatted in place immediately after generation. Without this,
// every codegen run produces spurious diffs (quote style, spacing) that churn
// the committed file against what lint-staged would rewrite on commit.
export async function runCodegen(): Promise<void> {
  const databaseUrl = readDatabaseUrlFromEnvLocal();
  execFileSync(
    'bun',
    [
      '--bun',
      'x',
      'kysely-codegen',
      '--dialect',
      'postgres',
      '--camel-case',
      '--url',
      databaseUrl,
      '--out-file',
      GENERATED_TYPES_FILE,
    ],
    { encoding: 'utf8', stdio: 'inherit' }
  );
  execFileSync(
    'bun',
    ['--bun', 'x', 'prettier', '--write', GENERATED_TYPES_FILE],
    { encoding: 'utf8', stdio: 'inherit' }
  );
  console.error(`db codegen: regenerated ${GENERATED_TYPES_FILE}`);
}
