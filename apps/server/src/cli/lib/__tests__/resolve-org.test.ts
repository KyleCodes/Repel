import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { resolveOrgId } from '../resolve-org.ts';

let original: string | undefined;

beforeEach(function () {
  original = process.env.REPEL_ORG_ID;
  delete process.env.REPEL_ORG_ID;
});

afterEach(function () {
  if (original === undefined) delete process.env.REPEL_ORG_ID;
  else process.env.REPEL_ORG_ID = original;
});

describe('resolveOrgId', function () {
  test('returns the flag verbatim when provided', function () {
    expect(resolveOrgId('o-flag')).toBe('o-flag');
  });

  test('flag wins over the environment variable', function () {
    process.env.REPEL_ORG_ID = 'o-env';
    expect(resolveOrgId('o-flag')).toBe('o-flag');
  });

  test('falls back to REPEL_ORG_ID when no flag is given', function () {
    process.env.REPEL_ORG_ID = 'o-env';
    expect(resolveOrgId(undefined)).toBe('o-env');
  });

  test('treats an empty-string flag as absent', function () {
    process.env.REPEL_ORG_ID = 'o-env';
    expect(resolveOrgId('')).toBe('o-env');
  });

  test('throws when neither flag nor env is set', function () {
    expect(function () {
      resolveOrgId(undefined);
    }).toThrow(/no org.*--org.*REPEL_ORG_ID/);
  });
});
