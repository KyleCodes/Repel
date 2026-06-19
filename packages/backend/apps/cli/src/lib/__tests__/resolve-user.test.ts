import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { resolveUserId } from '../resolve-user';

let original: string | undefined;

beforeEach(function () {
  original = process.env.REPEL_USER_ID;
  delete process.env.REPEL_USER_ID;
});

afterEach(function () {
  if (original === undefined) delete process.env.REPEL_USER_ID;
  else process.env.REPEL_USER_ID = original;
});

describe('resolveUserId', function () {
  test('returns the flag verbatim when provided', function () {
    expect(resolveUserId('u-flag')).toBe('u-flag');
  });

  test('flag wins over the environment variable', function () {
    process.env.REPEL_USER_ID = 'u-env';
    expect(resolveUserId('u-flag')).toBe('u-flag');
  });

  test('falls back to REPEL_USER_ID when no flag is given', function () {
    process.env.REPEL_USER_ID = 'u-env';
    expect(resolveUserId(undefined)).toBe('u-env');
  });

  test('treats an empty-string flag as absent', function () {
    process.env.REPEL_USER_ID = 'u-env';
    expect(resolveUserId('')).toBe('u-env');
  });

  test('throws when neither flag nor env is set', function () {
    expect(function () {
      resolveUserId(undefined);
    }).toThrow(/no user.*--user.*REPEL_USER_ID/);
  });
});
