import { describe, expect, test } from 'bun:test';
import {
  CloneInputSchema,
  DropInputSchema,
  MigrateCreateInputSchema,
  MigrateDownInputSchema,
  MigrateUpInputSchema,
  RefreshTemplateInputSchema,
  StatusInputSchema,
} from '../schemas.ts';

describe('CloneInputSchema', function () {
  test('applies defaults when only branch is provided', function () {
    const result = CloneInputSchema.parse({ branch: 'rep-38' });
    expect(result).toEqual({
      branch: 'rep-38',
      template: 'repel_dev',
      envFile: '.env.local',
      force: false,
    });
  });

  test('accepts all fields explicitly', function () {
    const result = CloneInputSchema.parse({
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
    expect(CloneInputSchema.safeParse({ branch: '' }).success).toBe(false);
  });

  test('rejects missing branch', function () {
    expect(CloneInputSchema.safeParse({}).success).toBe(false);
  });

  test('rejects non-string branch', function () {
    expect(CloneInputSchema.safeParse({ branch: 123 }).success).toBe(false);
  });
});

describe('DropInputSchema', function () {
  test('accepts a branch', function () {
    expect(DropInputSchema.parse({ branch: 'rep-38' })).toEqual({
      branch: 'rep-38',
    });
  });

  test('rejects empty branch', function () {
    expect(DropInputSchema.safeParse({ branch: '' }).success).toBe(false);
  });

  test('rejects missing branch', function () {
    expect(DropInputSchema.safeParse({}).success).toBe(false);
  });
});

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

describe('StatusInputSchema', function () {
  test('accepts empty object', function () {
    expect(StatusInputSchema.parse({})).toEqual({});
  });
});

describe('RefreshTemplateInputSchema', function () {
  test('defaults template to repel_dev', function () {
    expect(RefreshTemplateInputSchema.parse({})).toEqual({
      template: 'repel_dev',
    });
  });

  test('accepts an explicit template', function () {
    expect(RefreshTemplateInputSchema.parse({ template: 'foo' })).toEqual({
      template: 'foo',
    });
  });

  test('rejects empty template', function () {
    expect(RefreshTemplateInputSchema.safeParse({ template: '' }).success).toBe(
      false
    );
  });
});
