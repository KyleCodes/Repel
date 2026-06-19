import { describe, expect, test } from 'bun:test';
import {
  MigrateCreateInputSchema,
  MigrateDownInputSchema,
  MigrateUpInputSchema,
} from '../index';

describe('MigrateCreateInputSchema', function () {
  test('accepts empty object (name optional)', function () {
    expect(MigrateCreateInputSchema.parse({})).toEqual({});
  });

  test('accepts a valid name', function () {
    expect(MigrateCreateInputSchema.parse({ name: 'add_users' })).toEqual({
      name: 'add_users',
    });
  });

  test('rejects empty name', function () {
    expect(MigrateCreateInputSchema.safeParse({ name: '' }).success).toBe(
      false
    );
  });

  test('rejects non-string name', function () {
    expect(MigrateCreateInputSchema.safeParse({ name: 123 }).success).toBe(
      false
    );
  });
});

describe('MigrateUpInputSchema', function () {
  test('accepts empty object (match optional)', function () {
    expect(MigrateUpInputSchema.parse({})).toEqual({});
  });

  test('accepts a valid match', function () {
    expect(MigrateUpInputSchema.parse({ match: 'rep-39' })).toEqual({
      match: 'rep-39',
    });
  });

  test('rejects empty match', function () {
    expect(MigrateUpInputSchema.safeParse({ match: '' }).success).toBe(false);
  });

  test('rejects non-string match', function () {
    expect(MigrateUpInputSchema.safeParse({ match: 42 }).success).toBe(false);
  });
});

describe('MigrateDownInputSchema', function () {
  test('accepts empty object (match optional)', function () {
    expect(MigrateDownInputSchema.parse({})).toEqual({});
  });

  test('accepts a valid match', function () {
    expect(MigrateDownInputSchema.parse({ match: 'rep-39' })).toEqual({
      match: 'rep-39',
    });
  });

  test('rejects empty match', function () {
    expect(MigrateDownInputSchema.safeParse({ match: '' }).success).toBe(false);
  });

  test('rejects non-string match', function () {
    expect(MigrateDownInputSchema.safeParse({ match: 42 }).success).toBe(false);
  });

  test('accepts base alone', function () {
    expect(MigrateDownInputSchema.parse({ base: true })).toEqual({
      base: true,
    });
  });

  test('rejects match and base together', function () {
    const result = MigrateDownInputSchema.safeParse({
      match: 'rep-39',
      base: true,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        'Pass either [match] or --base, not both.'
      );
    }
  });
});
