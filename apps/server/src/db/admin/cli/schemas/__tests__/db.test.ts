import { describe, expect, test } from 'bun:test';
import {
  CloneInput,
  DropInput,
  MigrateCreateInput,
  MigrateDownInput,
  MigrateUpInput,
  RefreshTemplateInput,
  StatusInput,
} from '../db.ts';

describe('CloneInput', function () {
  test('applies defaults when only branch is provided', function () {
    const result = CloneInput.parse({ branch: 'rep-38' });
    expect(result).toEqual({
      branch: 'rep-38',
      template: 'repel_dev',
      envFile: '.env.local',
      force: false,
    });
  });

  test('accepts all fields explicitly', function () {
    const result = CloneInput.parse({
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
    const result = CloneInput.safeParse({ branch: '' });
    expect(result.success).toBe(false);
  });

  test('rejects missing branch', function () {
    const result = CloneInput.safeParse({});
    expect(result.success).toBe(false);
  });

  test('rejects non-string branch', function () {
    const result = CloneInput.safeParse({ branch: 123 });
    expect(result.success).toBe(false);
  });
});

describe('DropInput', function () {
  test('accepts a branch', function () {
    expect(DropInput.parse({ branch: 'rep-38' })).toEqual({ branch: 'rep-38' });
  });

  test('rejects empty branch', function () {
    expect(DropInput.safeParse({ branch: '' }).success).toBe(false);
  });

  test('rejects missing branch', function () {
    expect(DropInput.safeParse({}).success).toBe(false);
  });
});

describe('MigrateCreateInput', function () {
  test('accepts empty object (name optional)', function () {
    expect(MigrateCreateInput.parse({})).toEqual({});
  });

  test('accepts a valid name', function () {
    expect(MigrateCreateInput.parse({ name: 'rep-39' })).toEqual({
      name: 'rep-39',
    });
  });

  test('rejects empty name', function () {
    expect(MigrateCreateInput.safeParse({ name: '' }).success).toBe(false);
  });

  test('rejects non-string name', function () {
    expect(MigrateCreateInput.safeParse({ name: 123 }).success).toBe(false);
  });
});

describe('MigrateUpInput', function () {
  test('accepts empty object (target optional)', function () {
    expect(MigrateUpInput.parse({})).toEqual({});
  });

  test('accepts a valid target', function () {
    expect(MigrateUpInput.parse({ target: '20240101' })).toEqual({
      target: '20240101',
    });
  });

  test('rejects empty target', function () {
    expect(MigrateUpInput.safeParse({ target: '' }).success).toBe(false);
  });

  test('rejects non-string target', function () {
    expect(MigrateUpInput.safeParse({ target: 42 }).success).toBe(false);
  });
});

describe('MigrateDownInput', function () {
  test('accepts empty object (target optional)', function () {
    expect(MigrateDownInput.parse({})).toEqual({});
  });

  test('accepts a valid target', function () {
    expect(MigrateDownInput.parse({ target: '20240101' })).toEqual({
      target: '20240101',
    });
  });

  test('rejects empty target', function () {
    expect(MigrateDownInput.safeParse({ target: '' }).success).toBe(false);
  });

  test('rejects non-string target', function () {
    expect(MigrateDownInput.safeParse({ target: 42 }).success).toBe(false);
  });
});

describe('StatusInput', function () {
  test('accepts empty object', function () {
    expect(StatusInput.parse({})).toEqual({});
  });
});

describe('RefreshTemplateInput', function () {
  test('defaults template to repel_dev', function () {
    expect(RefreshTemplateInput.parse({})).toEqual({ template: 'repel_dev' });
  });

  test('accepts an explicit template', function () {
    expect(RefreshTemplateInput.parse({ template: 'foo' })).toEqual({
      template: 'foo',
    });
  });

  test('rejects empty template', function () {
    expect(RefreshTemplateInput.safeParse({ template: '' }).success).toBe(
      false
    );
  });
});
