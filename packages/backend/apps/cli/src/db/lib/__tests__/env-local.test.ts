import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readDatabaseUrlFromEnvLocal } from '../env-local';

let original: string | undefined;

beforeEach(function () {
  original = process.env.DATABASE_URL;
});

afterEach(function () {
  if (original === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = original;
});

describe('readDatabaseUrlFromEnvLocal', function () {
  test('returns DATABASE_URL when set', function () {
    process.env.DATABASE_URL = 'postgres://app@host:5432/repel_test';
    expect(readDatabaseUrlFromEnvLocal()).toBe(
      'postgres://app@host:5432/repel_test'
    );
  });

  test('throws when DATABASE_URL is unset', function () {
    delete process.env.DATABASE_URL;
    expect(function () {
      readDatabaseUrlFromEnvLocal();
    }).toThrow(/DATABASE_URL not set/);
  });
});
