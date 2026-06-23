import { describe, expect, test } from 'bun:test';
import { ServicesRunInputSchema } from '../index';

describe('ServicesRunInputSchema', function () {
  test('accepts a service name with all defaulted to false', function () {
    expect(ServicesRunInputSchema.parse({ name: 'api' })).toEqual({
      name: 'api',
      all: false,
    });
  });

  test('accepts --all with no name', function () {
    expect(ServicesRunInputSchema.parse({ all: true })).toEqual({ all: true });
  });

  test('rejects neither name nor --all (a bare `services run`)', function () {
    expect(ServicesRunInputSchema.safeParse({}).success).toBe(false);
  });

  test('rejects both a name and --all', function () {
    expect(
      ServicesRunInputSchema.safeParse({ name: 'api', all: true }).success
    ).toBe(false);
  });

  test('rejects an empty name', function () {
    expect(ServicesRunInputSchema.safeParse({ name: '' }).success).toBe(false);
  });
});
