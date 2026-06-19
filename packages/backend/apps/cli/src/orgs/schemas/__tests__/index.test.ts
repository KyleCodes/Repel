import { describe, expect, test } from 'bun:test';
import { BootstrapInputSchema } from '../index';

describe('BootstrapInputSchema', function () {
  test('applies its defaults', function () {
    expect(
      BootstrapInputSchema.parse({ orgName: 'Acme', email: 'a@b.com' })
    ).toEqual({ orgName: 'Acme', email: 'a@b.com', dryRun: false });
  });

  test('accepts an optional display name', function () {
    expect(
      BootstrapInputSchema.parse({
        orgName: 'Acme',
        email: 'a@b.com',
        name: 'Ada',
      })
    ).toEqual({
      orgName: 'Acme',
      email: 'a@b.com',
      name: 'Ada',
      dryRun: false,
    });
  });

  test('rejects a missing org name', function () {
    expect(BootstrapInputSchema.safeParse({ email: 'a@b.com' }).success).toBe(
      false
    );
  });

  test('rejects an empty org name', function () {
    expect(
      BootstrapInputSchema.safeParse({ orgName: '', email: 'a@b.com' }).success
    ).toBe(false);
  });

  test('rejects an invalid email', function () {
    expect(
      BootstrapInputSchema.safeParse({ orgName: 'Acme', email: 'nope' }).success
    ).toBe(false);
  });
});
