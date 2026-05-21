import { describe, expect, test } from 'bun:test';
import {
  CloneInputSchema,
  CodegenInputSchema,
  DropInputSchema,
  NukeInputSchema,
  RefreshTemplateInputSchema,
  StatusInputSchema,
} from '../index.ts';

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

describe('StatusInputSchema', function () {
  test('accepts empty object', function () {
    expect(StatusInputSchema.parse({})).toEqual({});
  });
});

describe('NukeInputSchema', function () {
  test('defaults yes to false', function () {
    expect(NukeInputSchema.parse({})).toEqual({ yes: false });
  });

  test('accepts an explicit yes', function () {
    expect(NukeInputSchema.parse({ yes: true })).toEqual({ yes: true });
  });

  test('rejects non-boolean yes', function () {
    expect(NukeInputSchema.safeParse({ yes: 'true' }).success).toBe(false);
  });
});

describe('CodegenInputSchema', function () {
  test('accepts empty object', function () {
    expect(CodegenInputSchema.parse({})).toEqual({});
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
