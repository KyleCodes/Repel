import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readDatabaseUrlFromEnvLocal } from '../env-local.js';

let cwd: string;
let originalCwd: string;

beforeEach(function () {
  originalCwd = process.cwd();
  cwd = mkdtempSync(join(tmpdir(), 'env-local-test-'));
  process.chdir(cwd);
});

afterEach(function () {
  process.chdir(originalCwd);
  rmSync(cwd, { recursive: true, force: true });
});

describe('readDatabaseUrlFromEnvLocal', function () {
  test('reads DATABASE_URL from .env.local', function () {
    writeFileSync(join(cwd, '.env.local'), 'DATABASE_URL=postgres://app@host:5432/repel_test\n');
    expect(readDatabaseUrlFromEnvLocal()).toBe('postgres://app@host:5432/repel_test');
  });

  test('strips surrounding double quotes', function () {
    writeFileSync(join(cwd, '.env.local'), 'DATABASE_URL="postgres://app@host:5432/repel_test"\n');
    expect(readDatabaseUrlFromEnvLocal()).toBe('postgres://app@host:5432/repel_test');
  });

  test('strips surrounding single quotes', function () {
    writeFileSync(join(cwd, '.env.local'), "DATABASE_URL='postgres://x'\n");
    expect(readDatabaseUrlFromEnvLocal()).toBe('postgres://x');
  });

  test('skips comments and blank lines', function () {
    writeFileSync(
      join(cwd, '.env.local'),
      '# comment\n\nFOO=bar\nDATABASE_URL=postgres://x\n',
    );
    expect(readDatabaseUrlFromEnvLocal()).toBe('postgres://x');
  });

  test('honors a custom env-file path', function () {
    writeFileSync(join(cwd, '.env.test'), 'DATABASE_URL=postgres://other\n');
    expect(readDatabaseUrlFromEnvLocal('.env.test')).toBe('postgres://other');
  });

  test('throws when the file is missing', function () {
    expect(function () {
      readDatabaseUrlFromEnvLocal();
    }).toThrow(/\.env\.local not found/);
  });

  test('throws when DATABASE_URL is absent', function () {
    writeFileSync(join(cwd, '.env.local'), 'FOO=bar\n');
    expect(function () {
      readDatabaseUrlFromEnvLocal();
    }).toThrow(/DATABASE_URL not set/);
  });

  test('throws when DATABASE_URL is empty', function () {
    writeFileSync(join(cwd, '.env.local'), 'DATABASE_URL=\n');
    expect(function () {
      readDatabaseUrlFromEnvLocal();
    }).toThrow(/DATABASE_URL is empty/);
  });
});
