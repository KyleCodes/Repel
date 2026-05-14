import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { RunnerOption } from 'node-pg-migrate';
import { sanitizeSlug } from '../../../lib/slug.ts';
import { extractTicketSlug } from './branch.ts';

// Walks up from process.cwd() looking for the repo root marker. The marker
// is `bun.lock` which uniquely identifies our workspace root (apps/ and
// packages/ never contain one). Resolving from cwd (not import.meta.url)
// keeps the path stable even if this file moves under a future restructure.
function findRepoRoot(): string {
  let dir = process.cwd();
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, 'bun.lock'))) return dir;
    dir = dirname(dir);
  }
  throw new Error(
    'Could not find repo root (no bun.lock in ancestor dirs of process.cwd())'
  );
}

// Absolute path to the migrations directory, resolved from the repo root.
// Boot-time existsSync check surfaces a clear error if the path drifts.
export const MIGRATIONS_DIR = join(
  findRepoRoot(),
  'apps/server/src/db/migrations'
);
if (!existsSync(MIGRATIONS_DIR)) {
  throw new Error(
    `MIGRATIONS_DIR does not exist at ${MIGRATIONS_DIR} — repo layout drifted from apps/server/src/db/migrations.`
  );
}

export interface FormatHeaderInput {
  name: string;
  branch: string;
  ticket: string | null;
  createdAt: Date;
}

// Emits the 4-line JSDoc header used at the top of every generated migration
// file. Trailing newline included so the migration body starts on a fresh line.
export function formatHeader(input: FormatHeaderInput): string {
  const ticket = input.ticket ?? 'unknown';
  return [
    '/**',
    ` * Migration: ${input.name}`,
    ` * Branch:    ${input.branch}`,
    ` * Ticket:    ${ticket}`,
    ` * Created:   ${input.createdAt.toISOString()}`,
    ' */',
    '',
  ].join('\n');
}

// Composes the migration name baked into the filename:
//   - No `explicit` → ticket slug alone (e.g. "rep-39")
//   - With `explicit` → "<ticket-slug>_<sanitized-explicit>" (e.g. "rep-39_add_users")
//   - No slug WITH `explicit` → sanitized explicit alone
//   - No slug AND no `explicit` → throw the exact AC error string
export function resolveMigrationName(input: {
  explicit: string | undefined;
  branch: string;
}): string {
  const slug = extractTicketSlug(input.branch);
  const slugLc = slug ? slug.toLowerCase() : null;
  if (!input.explicit) {
    if (slugLc) return slugLc;
    throw new Error(
      `Could not derive migration name from branch '${input.branch}'. Pass an explicit name.`
    );
  }
  const cleaned = sanitizeSlug(input.explicit);
  if (!cleaned) {
    throw new Error(
      `Migration name '${input.explicit}' sanitized to empty. Pass a name containing alphanumerics, '_', or '-'.`
    );
  }
  return slugLc ? `${slugLc}_${cleaned}` : cleaned;
}

// Reads MIGRATIONS_DIR (or override) and returns base filenames sorted by
// numeric unix-ms prefix. Single positive regex — anything not matching is
// skipped (covers README, .d.ts files, subdirectories, editor backups, etc.).
export function listFsMigrations(dir: string = MIGRATIONS_DIR): string[] {
  const PATTERN = /^(\d+)_[a-z0-9_-]+\.ts$/i;
  const entries = readdirSync(dir, { withFileTypes: true });
  const names: string[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!PATTERN.test(e.name)) continue;
    names.push(e.name.replace(/\.ts$/, ''));
  }
  names.sort(function (a, b) {
    const ai = Number(a.split('_')[0]);
    const bi = Number(b.split('_')[0]);
    return ai - bi;
  });
  return names;
}

export interface PartitionInput {
  fs: string[];
  applied: string[];
}

export interface PartitionResult {
  applied: string[];
  pending: string[];
  orphaned: string[];
}

// Splits the union of fs + applied into three deterministic, deduped buckets:
// applied = fs ∩ applied (fs order); pending = fs − applied (fs order);
// orphaned = applied − fs (applied order).
export function partitionStatus(input: PartitionInput): PartitionResult {
  const fsSet = new Set(input.fs);
  const appliedSet = new Set(input.applied);
  const applied: string[] = [];
  const pending: string[] = [];
  const orphaned: string[] = [];
  const seenA = new Set<string>();
  const seenP = new Set<string>();
  const seenO = new Set<string>();
  for (const f of input.fs) {
    if (appliedSet.has(f)) {
      if (!seenA.has(f)) {
        applied.push(f);
        seenA.add(f);
      }
    } else {
      if (!seenP.has(f)) {
        pending.push(f);
        seenP.add(f);
      }
    }
  }
  for (const a of input.applied) {
    if (!fsSet.has(a) && !seenO.has(a)) {
      orphaned.push(a);
      seenO.add(a);
    }
  }
  return { applied, pending, orphaned };
}

// Renders the partition result as an aligned two-column text table. Used by
// `repel db status` for stdout output. Empty-state collapses to a sentinel
// line so an empty table can never be mistaken for missing output.
export function renderStatusTable(input: PartitionResult): string {
  const rows: Array<[string, string]> = [];
  for (const n of input.applied) rows.push(['APPLIED', n]);
  for (const n of input.pending) rows.push(['PENDING', n]);
  for (const n of input.orphaned) rows.push(['ORPHANED', n]);

  const statusHeader = 'STATUS';
  const nameHeader = 'NAME';
  let statusWidth = statusHeader.length;
  let nameWidth = nameHeader.length;
  for (const [s, n] of rows) {
    if (s.length > statusWidth) statusWidth = s.length;
    if (n.length > nameWidth) nameWidth = n.length;
  }
  const pad = function (s: string, w: number): string {
    return s + ' '.repeat(w - s.length);
  };
  const header = `${pad(statusHeader, statusWidth)}  ${nameHeader}`;
  const separator = `${'-'.repeat(statusWidth)}  ${'-'.repeat(nameWidth)}`;
  if (rows.length === 0) {
    return [header, separator, 'no migrations found'].join('\n');
  }
  const body = rows
    .map(function ([s, n]) {
      return `${pad(s, statusWidth)}  ${n}`;
    })
    .join('\n');
  return [header, separator, body].join('\n');
}

// Resolves the user-supplied `[match]` substring against the filesystem list:
//   - No `match` → default count (Infinity for up, 1 for down)
//   - 1 substring hit → return { file: <full-name> }
//   - 0 hits → throw with a clear message
//   - >1 hits → throw with the candidate list so the user can narrow
export type ResolvedTarget = { file: string } | { count: number };
export function resolveMigrationMatch(
  match: string | undefined,
  direction: 'up' | 'down',
  fsMigrations: string[]
): ResolvedTarget {
  if (!match) {
    return { count: direction === 'up' ? Infinity : 1 };
  }
  const hits = fsMigrations.filter(function (n) {
    return n.includes(match);
  });
  if (hits.length === 0) {
    throw new Error(`db migrate ${direction}: no migration matches "${match}"`);
  }
  if (hits.length > 1) {
    throw new Error(
      `db migrate ${direction}: "${match}" matches multiple migrations:\n  - ${hits.join('\n  - ')}`
    );
  }
  return { file: hits[0] };
}

// Pure routing for node-pg-migrate's `runner` option object. Caller supplies
// the already-resolved target (either a unique filename or a count).
export function buildRunnerOptions(
  direction: 'up' | 'down',
  resolved: ResolvedTarget,
  env: { databaseUrl: string }
): RunnerOption {
  const base = {
    databaseUrl: env.databaseUrl,
    dir: MIGRATIONS_DIR,
    migrationsTable: 'pgmigrations',
    direction,
    log: function (msg: string): void {
      console.error(msg);
    },
  };
  if ('file' in resolved) {
    return { ...base, file: resolved.file };
  }
  return { ...base, count: resolved.count };
}

// Pulls the absolute generated migration path out of `node-pg-migrate create`
// stdout. Returns null when the marker isn't present so the caller can throw
// a clear error — no newest-mtime fallback.
export function parseGeneratedPath(stdout: string): string | null {
  const m = stdout.match(/Created migration -- (.+\.ts)\s*$/m);
  return m ? m[1] : null;
}

// Reads `filePath`, prepends `header`, writes back. Extracted as a pure helper
// so the file-mutation step can be unit-tested independently of the shell-out
// that creates the file.
export function applyHeaderToFile(filePath: string, header: string): void {
  const body = readFileSync(filePath, 'utf8');
  writeFileSync(filePath, header + body);
}
