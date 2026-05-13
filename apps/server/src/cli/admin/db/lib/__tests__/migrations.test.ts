import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  MIGRATIONS_DIR,
  applyHeaderToFile,
  buildRunnerOptions,
  formatHeader,
  listFsMigrations,
  parseGeneratedPath,
  partitionStatus,
  renderStatusTable,
  resolveMigrationName,
  sanitizeSlugFragment,
} from '../migrations.ts';

describe('MIGRATIONS_DIR', function () {
  test('points at apps/server/src/db/migrations', function () {
    expect(MIGRATIONS_DIR.endsWith('apps/server/src/db/migrations')).toBe(true);
  });
});

describe('formatHeader', function () {
  test('emits exact 4-line JSDoc block with all fields', function () {
    const out = formatHeader({
      name: 'rep-39',
      branch: 'kylemuldoon15/rep-39-foo',
      ticket: 'REP-39',
      createdAt: new Date('2026-05-12T00:00:00.000Z'),
    });
    expect(out).toBe(
      [
        '/**',
        ' * Migration: rep-39',
        ' * Branch:    kylemuldoon15/rep-39-foo',
        ' * Ticket:    REP-39',
        ' * Created:   2026-05-12T00:00:00.000Z',
        ' */',
        '',
      ].join('\n')
    );
  });

  test('renders literal "unknown" when ticket is null', function () {
    const out = formatHeader({
      name: 'rep-39',
      branch: 'main',
      ticket: null,
      createdAt: new Date('2026-05-12T00:00:00.000Z'),
    });
    expect(out).toContain(' * Ticket:    unknown');
  });

  test('ISO-8601 UTC date is rendered', function () {
    const out = formatHeader({
      name: 'x',
      branch: 'y',
      ticket: 'REP-1',
      createdAt: new Date('2026-01-02T03:04:05.678Z'),
    });
    expect(out).toContain(' * Created:   2026-01-02T03:04:05.678Z');
  });
});

describe('sanitizeSlugFragment', function () {
  test('lowercases and replaces non-[a-z0-9_-] runs with single underscore', function () {
    expect(sanitizeSlugFragment('Add Users!!')).toBe('add_users');
  });

  test('preserves underscores and hyphens', function () {
    expect(sanitizeSlugFragment('add_user-table')).toBe('add_user-table');
  });

  test('trims leading and trailing underscores', function () {
    expect(sanitizeSlugFragment('__foo__')).toBe('foo');
  });

  test('returns null when nothing usable remains', function () {
    expect(sanitizeSlugFragment('!!!')).toBeNull();
    expect(sanitizeSlugFragment('')).toBeNull();
  });
});

describe('resolveMigrationName', function () {
  test('explicit alone is appended to ticket slug when branch has one', function () {
    expect(
      resolveMigrationName({
        explicit: 'add_users',
        branch: 'kylemuldoon15/rep-39-foo',
      })
    ).toBe('rep-39_add_users');
  });

  test('explicit is sanitized before composition', function () {
    expect(
      resolveMigrationName({
        explicit: 'Add Users!',
        branch: 'kylemuldoon15/rep-39-foo',
      })
    ).toBe('rep-39_add_users');
  });

  test('no explicit → ticket slug alone (lower-cased)', function () {
    expect(
      resolveMigrationName({
        explicit: undefined,
        branch: 'kylemuldoon15/rep-39-t2-migrate',
      })
    ).toBe('rep-39');
  });

  test('no slug WITH explicit → sanitized explicit alone', function () {
    expect(
      resolveMigrationName({ explicit: 'add_users', branch: 'main' })
    ).toBe('add_users');
  });

  test('throws exact AC error string when no slug AND no name', function () {
    expect(function () {
      resolveMigrationName({ explicit: undefined, branch: 'main' });
    }).toThrow(
      "Could not derive migration name from branch 'main'. Pass an explicit name."
    );
  });

  test('throws when explicit sanitizes to empty', function () {
    expect(function () {
      resolveMigrationName({ explicit: '!!!', branch: 'main' });
    }).toThrow(/sanitized to empty/);
  });
});

describe('listFsMigrations', function () {
  let dir: string;
  beforeEach(function () {
    dir = mkdtempSync(join(tmpdir(), 'rep39-fs-'));
  });
  afterEach(function () {
    rmSync(dir, { recursive: true, force: true });
  });

  test('keeps <digits>_<slug>.ts, excludes README, .d.ts, subdirs, and unprefixed .ts', function () {
    writeFileSync(join(dir, '1777002187000_rep-9.ts'), '');
    writeFileSync(join(dir, '1700000000000_rep-1.ts'), '');
    writeFileSync(join(dir, '1750000000000_rep-39_add_users.ts'), '');
    writeFileSync(join(dir, 'README.md'), '');
    writeFileSync(join(dir, 'helpers.d.ts'), '');
    writeFileSync(join(dir, 'foo.ts'), '');
    mkdirSync(join(dir, 'subdir'));

    const result = listFsMigrations(dir);
    expect(result).toEqual([
      '1700000000000_rep-1',
      '1750000000000_rep-39_add_users',
      '1777002187000_rep-9',
    ]);
  });

  test('returns empty array for an empty directory', function () {
    expect(listFsMigrations(dir)).toEqual([]);
  });
});

describe('partitionStatus', function () {
  test('fs intersect applied is applied; fs minus applied is pending; applied minus fs is orphaned', function () {
    const result = partitionStatus({
      fs: ['a', 'b', 'c'],
      applied: ['a', 'b', 'd'],
    });
    expect(result).toEqual({
      applied: ['a', 'b'],
      pending: ['c'],
      orphaned: ['d'],
    });
  });

  test('empty fs and applied → all empty', function () {
    expect(partitionStatus({ fs: [], applied: [] })).toEqual({
      applied: [],
      pending: [],
      orphaned: [],
    });
  });

  test('preserves fs order for pending and applied order for orphaned', function () {
    const result = partitionStatus({
      fs: ['c', 'a', 'b'],
      applied: ['x', 'a', 'y'],
    });
    expect(result.applied).toEqual(['a']);
    expect(result.pending).toEqual(['c', 'b']);
    expect(result.orphaned).toEqual(['x', 'y']);
  });

  test('dedupes within buckets', function () {
    const result = partitionStatus({
      fs: ['a', 'a', 'b'],
      applied: ['a', 'a', 'c', 'c'],
    });
    expect(result.applied).toEqual(['a']);
    expect(result.pending).toEqual(['b']);
    expect(result.orphaned).toEqual(['c']);
  });
});

describe('renderStatusTable', function () {
  test('renders APPLIED then PENDING then ORPHANED with aligned columns', function () {
    const out = renderStatusTable({
      applied: ['a', 'b'],
      pending: ['cc'],
      orphaned: ['d'],
    });
    const lines = out.split('\n');
    expect(lines[0]).toMatch(/^STATUS\s+NAME$/);
    expect(lines[1]).toMatch(/^-+\s+-+$/);
    const rest = lines.slice(2);
    expect(rest[0]).toMatch(/^APPLIED\s+a$/);
    expect(rest[1]).toMatch(/^APPLIED\s+b$/);
    expect(rest[2]).toMatch(/^PENDING\s+cc$/);
    expect(rest[3]).toMatch(/^ORPHANED\s+d$/);
  });

  test('renders "no migrations found" when all buckets empty', function () {
    const out = renderStatusTable({
      applied: [],
      pending: [],
      orphaned: [],
    });
    const lines = out.split('\n');
    expect(lines[0]).toMatch(/^STATUS\s+NAME$/);
    expect(lines[1]).toMatch(/^-+\s+-+$/);
    expect(lines[2]).toBe('no migrations found');
  });
});

describe('buildRunnerOptions', function () {
  const env = { databaseUrl: 'postgres://x' };

  test("('up', undefined) → count Infinity, direction up", function () {
    const o = buildRunnerOptions('up', undefined, env);
    expect(o.direction).toBe('up');
    expect(o.count).toBe(Infinity);
    expect(o.dir).toBe(MIGRATIONS_DIR);
    expect(o.migrationsTable).toBe('pgmigrations');
    expect('databaseUrl' in o && o.databaseUrl).toBe('postgres://x');
  });

  test("('down', undefined) → count 1, direction down", function () {
    const o = buildRunnerOptions('down', undefined, env);
    expect(o.direction).toBe('down');
    expect(o.count).toBe(1);
  });

  test("('up', '20240101') → count 20240101, timestamp true", function () {
    const o = buildRunnerOptions('up', '20240101', env);
    expect(o.count).toBe(20240101);
    expect(o.timestamp).toBe(true);
    expect(o.direction).toBe('up');
  });

  test("('down', '20240101') → count 20240101, timestamp true, direction down", function () {
    const o = buildRunnerOptions('down', '20240101', env);
    expect(o.count).toBe(20240101);
    expect(o.timestamp).toBe(true);
    expect(o.direction).toBe('down');
  });

  test("('up', '1700000000000_rep-9') → file branch, no count, no timestamp", function () {
    const o = buildRunnerOptions('up', '1700000000000_rep-9', env);
    expect(o.file).toBe('1700000000000_rep-9');
    expect(o.count).toBeUndefined();
    expect(o.timestamp).toBeUndefined();
  });

  test("('up', 'abc123') → file branch", function () {
    const o = buildRunnerOptions('up', 'abc123', env);
    expect(o.file).toBe('abc123');
  });

  test("('up', ' 123 ') → file branch (whitespace prevents digits match)", function () {
    const o = buildRunnerOptions('up', ' 123 ', env);
    expect(o.file).toBe(' 123 ');
    expect(o.count).toBeUndefined();
  });

  test("('up', '0') → digits branch, count 0", function () {
    const o = buildRunnerOptions('up', '0', env);
    expect(o.count).toBe(0);
    expect(o.timestamp).toBe(true);
  });

  test("('up', '007') → digits branch, count 7", function () {
    const o = buildRunnerOptions('up', '007', env);
    expect(o.count).toBe(7);
  });

  test('log option routes to console.error', function () {
    const o = buildRunnerOptions('up', undefined, env);
    expect(typeof o.log).toBe('function');
  });
});

describe('parseGeneratedPath', function () {
  test('matches "Created migration -- /abs/path/X.ts"', function () {
    const stdout =
      'some preface\nCreated migration -- /tmp/migrations/1777_rep-9.ts\nepilogue\n';
    expect(parseGeneratedPath(stdout)).toBe('/tmp/migrations/1777_rep-9.ts');
  });

  test('returns null when no match', function () {
    expect(parseGeneratedPath('nothing here')).toBeNull();
  });
});

describe('applyHeaderToFile', function () {
  let dir: string;
  beforeEach(function () {
    dir = mkdtempSync(join(tmpdir(), 'rep39-apply-'));
  });
  afterEach(function () {
    rmSync(dir, { recursive: true, force: true });
  });

  test('prepends header to existing body, preserving body content', function () {
    const file = join(dir, '1_a.ts');
    writeFileSync(file, 'export const x = 1;\n');
    applyHeaderToFile(file, '/**\n * Migration: a\n */\n');
    const out = readFileSync(file, 'utf8');
    expect(out).toBe('/**\n * Migration: a\n */\nexport const x = 1;\n');
  });
});
