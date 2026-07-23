import { describe, expect, test } from 'bun:test';
import { MigrateCreateInputSchema, MigrateUpInputSchema } from '../index';

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
  test('accepts empty object — up takes no targeting input under migrate deploy', function () {
    expect(MigrateUpInputSchema.parse({})).toEqual({});
  });
});
