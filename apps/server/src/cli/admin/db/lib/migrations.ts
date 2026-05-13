import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunnerOption } from 'node-pg-migrate';
import { extractTicketSlug } from './branch.ts';

// Absolute path to the migrations directory. Resolved off this file's location
// so the value is stable regardless of process cwd. Boot-time existsSync check
// surfaces a clear error if the relative chain is wrong (e.g. after a future
// restructure of cli/admin/db/). See D6 in the plan for the long-term home.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const MIGRATIONS_DIR = resolve(__dirname, '../../../../db/migrations');
if (!existsSync(MIGRATIONS_DIR)) {
  throw new Error(
    `MIGRATIONS_DIR does not exist at ${MIGRATIONS_DIR} — the relative chain in cli/admin/db/lib/migrations.ts is out of date.`
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

// Normalizes a user-supplied slug fragment: lowercase, collapse non-[a-z0-9_-]
// runs into a single underscore, trim leading/trailing underscores. Returns
// the sanitized string or null if nothing usable remains.
export function sanitizeSlugFragment(raw: string): string | null {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned.length > 0 ? cleaned : null;
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
  if (input.explicit === undefined) {
    if (slugLc) return slugLc;
    throw new Error(
      `Could not derive migration name from branch '${input.branch}'. Pass an explicit name.`
    );
  }
  const cleaned = sanitizeSlugFragment(input.explicit);
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

// Pure routing for node-pg-migrate's `runner` option object.
export function buildRunnerOptions(
  direction: 'up' | 'down',
  target: string | undefined,
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
  if (target === undefined) {
    return { ...base, count: direction === 'up' ? Infinity : 1 };
  }
  if (/^\d+$/.test(target)) {
    return { ...base, count: Number(target), timestamp: true };
  }
  return { ...base, file: target };
}

// Pulls the absolute generated migration path out of `node-pg-migrate create`
// stdout. Returns null when the marker isn't present so the caller can throw
// a clear error — no newest-mtime fallback per DR-REP-39-2 follow-up.
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
