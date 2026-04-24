import { describe, expect, test } from 'bun:test';
import { buildDatabaseUrl, resolveAdminUrl } from '../admin-url.js';

describe('resolveAdminUrl', function () {
  test('returns pgAdminUrl verbatim when set', function () {
    expect(
      resolveAdminUrl({ pgAdminUrl: 'postgres://admin@host:5432/postgres' }),
    ).toBe('postgres://admin@host:5432/postgres');
  });

  test('pgAdminUrl wins when both are set', function () {
    expect(
      resolveAdminUrl({
        pgAdminUrl: 'postgres://admin@host:5432/postgres',
        databaseUrl: 'postgres://app@host:5432/repel_dev',
      }),
    ).toBe('postgres://admin@host:5432/postgres');
  });

  test('derives from databaseUrl by swapping path to /postgres', function () {
    expect(
      resolveAdminUrl({ databaseUrl: 'postgres://app@host:5432/repel_dev' }),
    ).toBe('postgres://app@host:5432/postgres');
  });

  test('throws when neither is set', function () {
    expect(function () {
      resolveAdminUrl({});
    }).toThrow('PG_ADMIN_URL or DATABASE_URL is required');
  });
});

describe('buildDatabaseUrl', function () {
  test('swaps the path segment with the given db name', function () {
    expect(
      buildDatabaseUrl('postgres://admin@host:5432/postgres', 'repel_rep_99'),
    ).toBe('postgres://admin@host:5432/repel_rep_99');
  });

  test('preserves credentials and port from admin url', function () {
    expect(
      buildDatabaseUrl('postgres://user:secret@db.internal:6543/postgres', 'repel_x'),
    ).toBe('postgres://user:secret@db.internal:6543/repel_x');
  });
});
