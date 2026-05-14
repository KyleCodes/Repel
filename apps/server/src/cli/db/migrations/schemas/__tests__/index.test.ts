import { describe, expect, test } from 'bun:test';
import {
  MigrateCreateInputSchema,
  MigrateDownInputSchema,
  MigrateUpInputSchema,
} from '../index.ts';

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
});
