import { describe, expect, test } from 'bun:test';
import { CloneInput, DropInput, RefreshTemplateInput } from '../db.js';

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

describe('RefreshTemplateInput', function () {
  test('defaults template to repel_dev', function () {
    expect(RefreshTemplateInput.parse({})).toEqual({ template: 'repel_dev' });
  });

  test('accepts an explicit template', function () {
    expect(RefreshTemplateInput.parse({ template: 'foo' })).toEqual({ template: 'foo' });
  });

  test('rejects empty template', function () {
    expect(RefreshTemplateInput.safeParse({ template: '' }).success).toBe(false);
  });
});
