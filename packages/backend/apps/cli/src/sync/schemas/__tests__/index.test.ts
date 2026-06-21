import { describe, expect, test } from 'bun:test';
import { SyncRunInputSchema } from '../index';

describe('SyncRunInputSchema', function () {
  test('accepts a minimal valid input (accountRef + full:true)', function () {
    expect(
      SyncRunInputSchema.parse({ accountRef: 'work', full: true })
    ).toEqual({ accountRef: 'work', full: true });
  });

  test('rejects an empty accountRef', function () {
    expect(
      SyncRunInputSchema.safeParse({ accountRef: '', full: true }).success
    ).toBe(false);
  });

  test('rejects a missing accountRef', function () {
    expect(SyncRunInputSchema.safeParse({ full: true }).success).toBe(false);
  });

  test('rejects full:false with a message pointing to REP-53', function () {
    const result = SyncRunInputSchema.safeParse({
      accountRef: 'work',
      full: false,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const joined = result.error.issues.map((i) => i.message).join(' ');
      expect(joined).toContain('REP-53');
    }
  });

  test('rejects an absent full with a message pointing to REP-53', function () {
    const result = SyncRunInputSchema.safeParse({ accountRef: 'work' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const joined = result.error.issues.map((i) => i.message).join(' ');
      expect(joined).toContain('REP-53');
    }
  });

  test("coerces a string limit '20' to the number 20", function () {
    const parsed = SyncRunInputSchema.parse({
      accountRef: 'work',
      full: true,
      limit: '20',
    });
    expect(parsed.limit).toBe(20);
  });

  test('accepts an omitted limit', function () {
    const parsed = SyncRunInputSchema.parse({ accountRef: 'work', full: true });
    expect(parsed.limit).toBeUndefined();
  });

  test('rejects a limit of 0', function () {
    expect(
      SyncRunInputSchema.safeParse({
        accountRef: 'work',
        full: true,
        limit: '0',
      }).success
    ).toBe(false);
  });

  test('rejects a negative limit', function () {
    expect(
      SyncRunInputSchema.safeParse({
        accountRef: 'work',
        full: true,
        limit: '-5',
      }).success
    ).toBe(false);
  });

  test('rejects a non-integer limit', function () {
    expect(
      SyncRunInputSchema.safeParse({
        accountRef: 'work',
        full: true,
        limit: '2.5',
      }).success
    ).toBe(false);
  });

  test('rejects a non-numeric limit', function () {
    expect(
      SyncRunInputSchema.safeParse({
        accountRef: 'work',
        full: true,
        limit: 'abc',
      }).success
    ).toBe(false);
  });

  test('accepts optional org and user', function () {
    expect(
      SyncRunInputSchema.parse({
        accountRef: 'work',
        full: true,
        org: 'o-1',
        user: 'u-1',
      })
    ).toEqual({ accountRef: 'work', full: true, org: 'o-1', user: 'u-1' });
  });
});
