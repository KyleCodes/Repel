import { describe, expect, test } from 'bun:test';
import {
  CodegenInputSchema,
  DumpInputSchema,
  NukeInputSchema,
  RefreshTemplateInputSchema,
  RestoreInputSchema,
  StatusInputSchema,
} from '../index';

describe('DumpInputSchema', function () {
  test('defaults database to repel when only out is given', function () {
    expect(DumpInputSchema.parse({ out: 'data/seed.dump' })).toEqual({
      out: 'data/seed.dump',
      database: 'repel',
    });
  });

  test('accepts an explicit database', function () {
    expect(
      DumpInputSchema.parse({ out: 'data/seed.dump', database: 'repel_dev' })
    ).toEqual({ out: 'data/seed.dump', database: 'repel_dev' });
  });

  test('rejects missing out', function () {
    expect(DumpInputSchema.safeParse({}).success).toBe(false);
  });

  test('rejects empty out', function () {
    expect(DumpInputSchema.safeParse({ out: '' }).success).toBe(false);
  });
});

describe('RestoreInputSchema', function () {
  test('accepts a fromFile, defaults database to repel', function () {
    expect(RestoreInputSchema.parse({ fromFile: 'data/seed.dump' })).toEqual({
      fromFile: 'data/seed.dump',
      database: 'repel',
    });
  });

  test('rejects missing fromFile', function () {
    expect(RestoreInputSchema.safeParse({}).success).toBe(false);
  });

  test('rejects empty fromFile', function () {
    expect(RestoreInputSchema.safeParse({ fromFile: '' }).success).toBe(false);
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
