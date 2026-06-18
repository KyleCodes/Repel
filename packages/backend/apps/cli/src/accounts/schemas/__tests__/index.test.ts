import { describe, expect, test } from 'bun:test';
import {
  AccountConnectInputSchema,
  AccountListInputSchema,
  AccountReconnectInputSchema,
  AccountRmInputSchema,
  AccountShowInputSchema,
} from '../index.ts';

describe('AccountListInputSchema', function () {
  test('accepts an empty object — org and user are both optional', function () {
    expect(AccountListInputSchema.parse({})).toEqual({});
  });

  test('accepts org and user together', function () {
    expect(AccountListInputSchema.parse({ org: 'o-1', user: 'u-1' })).toEqual({
      org: 'o-1',
      user: 'u-1',
    });
  });

  test('rejects a non-string org', function () {
    expect(AccountListInputSchema.safeParse({ org: 123 }).success).toBe(false);
  });
});

describe('AccountShowInputSchema', function () {
  test('accepts an account token', function () {
    expect(AccountShowInputSchema.parse({ account: 'work' })).toEqual({
      account: 'work',
    });
  });

  test('accepts an optional org', function () {
    expect(
      AccountShowInputSchema.parse({ account: 'work', org: 'o-1' })
    ).toEqual({ account: 'work', org: 'o-1' });
  });

  test('rejects a missing account', function () {
    expect(AccountShowInputSchema.safeParse({}).success).toBe(false);
  });

  test('rejects an empty account', function () {
    expect(AccountShowInputSchema.safeParse({ account: '' }).success).toBe(
      false
    );
  });
});

describe('AccountRmInputSchema', function () {
  test('defaults yes to false', function () {
    expect(AccountRmInputSchema.parse({ account: 'work' })).toEqual({
      account: 'work',
      yes: false,
    });
  });

  test('accepts an explicit yes', function () {
    expect(AccountRmInputSchema.parse({ account: 'work', yes: true })).toEqual({
      account: 'work',
      yes: true,
    });
  });

  test('rejects a missing account', function () {
    expect(AccountRmInputSchema.safeParse({ yes: true }).success).toBe(false);
  });

  test('rejects an empty account', function () {
    expect(AccountRmInputSchema.safeParse({ account: '' }).success).toBe(false);
  });

  test('rejects a non-boolean yes', function () {
    expect(
      AccountRmInputSchema.safeParse({ account: 'work', yes: 'true' }).success
    ).toBe(false);
  });
});

describe('AccountConnectInputSchema', function () {
  test('accepts gmail', function () {
    expect(AccountConnectInputSchema.parse({ provider: 'gmail' })).toEqual({
      provider: 'gmail',
    });
  });

  test('accepts icloud', function () {
    expect(AccountConnectInputSchema.parse({ provider: 'icloud' })).toEqual({
      provider: 'icloud',
    });
  });

  test('accepts generic_imap', function () {
    expect(
      AccountConnectInputSchema.parse({ provider: 'generic_imap' })
    ).toEqual({
      provider: 'generic_imap',
    });
  });

  test('accepts optional org and user', function () {
    expect(
      AccountConnectInputSchema.parse({
        provider: 'gmail',
        org: 'o-1',
        user: 'u-1',
      })
    ).toEqual({ provider: 'gmail', org: 'o-1', user: 'u-1' });
  });

  test('rejects an unsupported provider', function () {
    expect(
      AccountConnectInputSchema.safeParse({ provider: 'outlook' }).success
    ).toBe(false);
  });

  test('rejects a missing provider', function () {
    expect(AccountConnectInputSchema.safeParse({}).success).toBe(false);
  });

  test('accepts an optional alias', function () {
    expect(
      AccountConnectInputSchema.parse({ provider: 'gmail', alias: 'work' })
    ).toEqual({ provider: 'gmail', alias: 'work' });
  });

  test('parses alias as undefined when omitted', function () {
    const parsed = AccountConnectInputSchema.parse({ provider: 'gmail' });
    expect(parsed.alias).toBeUndefined();
  });

  test('rejects an empty alias (min 1)', function () {
    expect(
      AccountConnectInputSchema.safeParse({ provider: 'gmail', alias: '' })
        .success
    ).toBe(false);
  });
});

describe('AccountReconnectInputSchema', function () {
  test('accepts an account token', function () {
    expect(AccountReconnectInputSchema.parse({ account: 'work' })).toEqual({
      account: 'work',
    });
  });

  test('accepts an optional org', function () {
    expect(
      AccountReconnectInputSchema.parse({ account: 'work', org: 'o-1' })
    ).toEqual({ account: 'work', org: 'o-1' });
  });

  test('rejects a missing account', function () {
    expect(AccountReconnectInputSchema.safeParse({}).success).toBe(false);
  });

  test('rejects an empty account', function () {
    expect(AccountReconnectInputSchema.safeParse({ account: '' }).success).toBe(
      false
    );
  });
});
