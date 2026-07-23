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
  findCreatedMigrationDir,
  formatHeader,
  listFsMigrations,
  partitionStatus,
  renderStatusTable,
  resolveMigrationName,
} from '../migrations';

describe('MIGRATIONS_DIR', function () {
  test('points at packages/backend/libs/db/prisma/migrations', function () {
    expect(
      MIGRATIONS_DIR.endsWith('packages/backend/libs/db/prisma/migrations')
    ).toBe(true);
  });
});

describe('formatHeader', function () {
  test('emits exact 4-line SQL comment block with all fields', function () {
    const out = formatHeader({
      name: 'rep-39',
      branch: 'kylemuldoon15/rep-39-foo',
      ticket: 'REP-39',
      createdAt: new Date('2026-05-12T00:00:00.000Z'),
    });
    expect(out).toBe(
      [
        '-- Migration: rep-39',
        '-- Branch:    kylemuldoon15/rep-39-foo',
        '-- Ticket:    REP-39',
        '-- Created:   2026-05-12T00:00:00.000Z',
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
    expect(out).toContain('-- Ticket:    unknown');
  });

  test('ISO-8601 UTC date is rendered', function () {
    const out = formatHeader({
      name: 'x',
      branch: 'y',
      ticket: 'REP-1',
      createdAt: new Date('2026-01-02T03:04:05.678Z'),
    });
    expect(out).toContain('-- Created:   2026-01-02T03:04:05.678Z');
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

  test('empty-string explicit treated as no explicit', function () {
    expect(
      resolveMigrationName({
        explicit: '',
        branch: 'kylemuldoon15/rep-39-foo',
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

  test('keeps <digits>_<slug> directories, excludes files and unprefixed dirs', function () {
    mkdirSync(join(dir, '0_init'));
    mkdirSync(join(dir, '20260723100000_rep-39_add_users'));
    mkdirSync(join(dir, '20250101000000_rep-9'));
    mkdirSync(join(dir, 'not-a-migration'));
    writeFileSync(join(dir, 'migration_lock.toml'), '');
    writeFileSync(join(dir, '999_stray-file'), '');

    const result = listFsMigrations(dir);
    expect(result).toEqual([
      '0_init',
      '20250101000000_rep-9',
      '20260723100000_rep-39_add_users',
    ]);
  });

  test('returns empty array for an empty directory', function () {
    expect(listFsMigrations(dir)).toEqual([]);
  });
});

describe('findCreatedMigrationDir', function () {
  let dir: string;
  beforeEach(function () {
    dir = mkdtempSync(join(tmpdir(), 'rep39-created-'));
  });
  afterEach(function () {
    rmSync(dir, { recursive: true, force: true });
  });

  test('resolves the newest directory whose suffix matches the name', function () {
    mkdirSync(join(dir, '20250101000000_rep-39'));
    mkdirSync(join(dir, '20260723100000_rep-39'));
    mkdirSync(join(dir, '20260723100001_other'));
    expect(findCreatedMigrationDir('rep-39', dir)).toBe(
      join(dir, '20260723100000_rep-39')
    );
  });

  test('returns null when nothing matches', function () {
    mkdirSync(join(dir, '20260723100001_other'));
    expect(findCreatedMigrationDir('rep-39', dir)).toBeNull();
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

describe('applyHeaderToFile', function () {
  let dir: string;
  beforeEach(function () {
    dir = mkdtempSync(join(tmpdir(), 'rep39-hdr-'));
  });
  afterEach(function () {
    rmSync(dir, { recursive: true, force: true });
  });

  test('prepends the header to the file body', function () {
    const filePath = join(dir, 'migration.sql');
    writeFileSync(filePath, 'ALTER TABLE x ADD COLUMN y text;\n');
    applyHeaderToFile(filePath, '-- header\n');
    expect(readFileSync(filePath, 'utf8')).toBe(
      '-- header\nALTER TABLE x ADD COLUMN y text;\n'
    );
  });
});
