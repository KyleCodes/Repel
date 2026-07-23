import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { sanitizeSlug } from '@repel/slug';
import { extractTicketSlug } from './branch';

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

// The db package root — where prisma.config.ts and prisma/schema.prisma live,
// and the cwd every Prisma CLI invocation is pinned to.
export const DB_PACKAGE_DIR = join(findRepoRoot(), 'packages/backend/libs/db');

// Absolute path to the Prisma migrations directory. Boot-time existsSync
// check surfaces a clear error if the path drifts.
export const MIGRATIONS_DIR = join(DB_PACKAGE_DIR, 'prisma/migrations');
if (!existsSync(MIGRATIONS_DIR)) {
  throw new Error(
    `MIGRATIONS_DIR does not exist at ${MIGRATIONS_DIR} — repo layout drifted from packages/backend/libs/db/prisma/migrations.`
  );
}

export interface FormatHeaderInput {
  name: string;
  branch: string;
  ticket: string | null;
  createdAt: Date;
}

// Emits the header comment prepended to every generated migration.sql.
// SQL line comments — the file is plain SQL under Prisma Migrate. The
// trailing newline keeps the migration body on a fresh line. Editing a
// migration file after it has been applied changes its checksum and Prisma
// flags it — which is why the header is written at create time, before apply.
export function formatHeader(input: FormatHeaderInput): string {
  const ticket = input.ticket ?? 'unknown';
  return [
    `-- Migration: ${input.name}`,
    `-- Branch:    ${input.branch}`,
    `-- Ticket:    ${ticket}`,
    `-- Created:   ${input.createdAt.toISOString()}`,
    '',
  ].join('\n');
}

// Composes the migration name passed to `prisma migrate dev --name`:
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

// Reads MIGRATIONS_DIR (or override) and returns migration directory names
// sorted by numeric prefix. Prisma migrations are directories named
// <timestamp>_<name> (the baseline is 0_init); anything else in the tree
// (migration_lock.toml, editor backups) is skipped.
export function listFsMigrations(dir: string = MIGRATIONS_DIR): string[] {
  const PATTERN = /^(\d+)_[a-z0-9_-]+$/i;
  const entries = readdirSync(dir, { withFileTypes: true });
  const names: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (!PATTERN.test(e.name)) continue;
    names.push(e.name);
  }
  names.sort(function (a, b) {
    const ai = Number(a.split('_')[0]);
    const bi = Number(b.split('_')[0]);
    return ai - bi;
  });
  return names;
}

// Locates the migration directory `prisma migrate dev --create-only --name X`
// just wrote: the highest-timestamp directory whose suffix matches the name.
// Prisma applies its own sanitization to --name (dashes become underscores),
// so both sides are normalized before comparing. Returns null when none
// matches so the caller can throw a clear error.
export function findCreatedMigrationDir(
  name: string,
  dir: string = MIGRATIONS_DIR
): string | null {
  const wanted = `_${name.replace(/-/g, '_')}`;
  const matches = listFsMigrations(dir).filter(function (n) {
    return n.replace(/-/g, '_').endsWith(wanted);
  });
  if (matches.length === 0) return null;
  return join(dir, matches[matches.length - 1]!);
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

// Reads `filePath`, prepends `header`, writes back. Extracted as a pure helper
// so the file-mutation step can be unit-tested independently of the shell-out
// that creates the file.
export function applyHeaderToFile(filePath: string, header: string): void {
  const body = readFileSync(filePath, 'utf8');
  writeFileSync(filePath, header + body);
}
