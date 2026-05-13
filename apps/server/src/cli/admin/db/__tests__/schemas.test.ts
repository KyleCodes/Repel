import { describe, expect, test } from 'bun:test';
import {
  CloneSchema,
  DropSchema,
  MigrateCreateSchema,
  MigrateDownSchema,
  MigrateUpSchema,
  RefreshTemplateSchema,
  StatusSchema,
} from '../schemas.ts';

describe('CloneSchema', function () {
  test('applies defaults when only branch is provided', function () {
    const result = CloneSchema.parse({ branch: 'rep-38' });
    expect(result).toEqual({
      branch: 'rep-38',
      template: 'repel_dev',
      envFile: '.env.local',
      force: false,
    });
  });

  test('accepts all fields explicitly', function () {
    const result = CloneSchema.parse({
      branch: 'rep-38',
      template: 'custom_template',
      envFile: '.env.test',
      force: true,
    });
    expect(result).toEqual({
      branch: 'rep-38',
      template: 'custom_template',
      envFile: '.env.test',
      force: true,
    });
  });

  test('rejects empty branch', function () {
    expect(CloneSchema.safeParse({ branch: '' }).success).toBe(false);
  });

  test('rejects missing branch', function () {
    expect(CloneSchema.safeParse({}).success).toBe(false);
  });

  test('rejects non-string branch', function () {
    expect(CloneSchema.safeParse({ branch: 123 }).success).toBe(false);
  });
});

describe('DropSchema', function () {
  test('accepts a branch', function () {
    expect(DropSchema.parse({ branch: 'rep-38' })).toEqual({
      branch: 'rep-38',
    });
  });

  test('rejects empty branch', function () {
    expect(DropSchema.safeParse({ branch: '' }).success).toBe(false);
  });

  test('rejects missing branch', function () {
    expect(DropSchema.safeParse({}).success).toBe(false);
  });
});

describe('MigrateCreateSchema', function () {
  test('accepts empty object (name optional)', function () {
    expect(MigrateCreateSchema.parse({})).toEqual({});
  });

  test('accepts a valid name', function () {
    expect(MigrateCreateSchema.parse({ name: 'add_users' })).toEqual({
      name: 'add_users',
    });
  });

  test('rejects empty name', function () {
    expect(MigrateCreateSchema.safeParse({ name: '' }).success).toBe(false);
  });

  test('rejects non-string name', function () {
    expect(MigrateCreateSchema.safeParse({ name: 123 }).success).toBe(false);
  });
});

describe('MigrateUpSchema', function () {
  test('accepts empty object (target optional)', function () {
    expect(MigrateUpSchema.parse({})).toEqual({});
  });

  test('accepts a valid target', function () {
    expect(MigrateUpSchema.parse({ target: '20240101' })).toEqual({
      target: '20240101',
    });
  });

  test('rejects empty target', function () {
    expect(MigrateUpSchema.safeParse({ target: '' }).success).toBe(false);
  });

  test('rejects non-string target', function () {
    expect(MigrateUpSchema.safeParse({ target: 42 }).success).toBe(false);
  });
});

describe('MigrateDownSchema', function () {
  test('accepts empty object (target optional)', function () {
    expect(MigrateDownSchema.parse({})).toEqual({});
  });

  test('accepts a valid target', function () {
    expect(MigrateDownSchema.parse({ target: '20240101' })).toEqual({
      target: '20240101',
    });
  });

  test('rejects empty target', function () {
    expect(MigrateDownSchema.safeParse({ target: '' }).success).toBe(false);
  });

  test('rejects non-string target', function () {
    expect(MigrateDownSchema.safeParse({ target: 42 }).success).toBe(false);
  });
});

describe('StatusSchema', function () {
  test('accepts empty object', function () {
    expect(StatusSchema.parse({})).toEqual({});
  });
});

describe('RefreshTemplateSchema', function () {
  test('defaults template to repel_dev', function () {
    expect(RefreshTemplateSchema.parse({})).toEqual({ template: 'repel_dev' });
  });

  test('accepts an explicit template', function () {
    expect(RefreshTemplateSchema.parse({ template: 'foo' })).toEqual({
      template: 'foo',
    });
  });

  test('rejects empty template', function () {
    expect(RefreshTemplateSchema.safeParse({ template: '' }).success).toBe(
      false
    );
  });
});
