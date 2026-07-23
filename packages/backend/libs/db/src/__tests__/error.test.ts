import { describe, expect, test } from 'bun:test';
import { AppError } from '@repel/errors';
import { DBError, DBUniqueViolationError, normalizeDbError } from '../error';
import { Prisma } from '../prisma/client';

// A concrete AppError standing in for any domain error a view/mutation might
// throw inside a tx (e.g. ProviderAccountNotFoundError).
class FakeDomainError extends AppError {}

describe('normalizeDbError', function () {
  test('passes an existing AppError through unchanged (same instance)', function () {
    const original = new FakeDomainError('not found');
    expect(normalizeDbError(original)).toBe(original);
  });

  test('passes an already-built DBError through unchanged', function () {
    const original = new DBUniqueViolationError('dupe', 'c', '23505');
    expect(normalizeDbError(original)).toBe(original);
  });

  test('maps a 23505 with a constraint to DBUniqueViolationError', function () {
    const result = normalizeDbError({
      code: '23505',
      constraint: 'some_table_uniq_a_b',
    });
    expect(result).toBeInstanceOf(DBUniqueViolationError);
    expect((result as DBUniqueViolationError).constraint).toBe(
      'some_table_uniq_a_b'
    );
    expect((result as DBUniqueViolationError).code).toBe('23505');
  });

  test('maps a 23505 without a constraint to DBUniqueViolationError (constraint undefined)', function () {
    const result = normalizeDbError({ code: '23505' });
    expect(result).toBeInstanceOf(DBUniqueViolationError);
    expect((result as DBUniqueViolationError).constraint).toBeUndefined();
    expect((result as DBUniqueViolationError).code).toBe('23505');
  });

  test('maps a non-unique pg error (23503) to a plain DBError carrying the code', function () {
    const result = normalizeDbError({ code: '23503' });
    expect(result).toBeInstanceOf(DBError);
    expect(result).not.toBeInstanceOf(DBUniqueViolationError);
    expect((result as DBError).code).toBe('23503');
  });

  test('uses the pg message when present', function () {
    const result = normalizeDbError({ code: '23503', message: 'fk violated' });
    expect(result.message).toBe('fk violated');
  });

  test('ignores a non-string constraint field', function () {
    const result = normalizeDbError({ code: '23505', constraint: 42 });
    expect(result).toBeInstanceOf(DBUniqueViolationError);
    expect((result as DBUniqueViolationError).constraint).toBeUndefined();
  });

  test('wraps a generic Error in a DBError with no code', function () {
    const result = normalizeDbError(new Error('boom'));
    expect(result).toBeInstanceOf(DBError);
    expect((result as DBError).code).toBeUndefined();
    expect(result.message).toBe('boom');
  });

  test('wraps a plain object without a code in a DBError', function () {
    const result = normalizeDbError({ constraint: 'some_table_uniq_a_b' });
    expect(result).toBeInstanceOf(DBError);
    expect((result as DBError).code).toBeUndefined();
  });

  test('wraps a string', function () {
    const result = normalizeDbError('23505');
    expect(result).toBeInstanceOf(DBError);
    expect(result.message).toBe('23505');
  });

  test('wraps null', function () {
    expect(normalizeDbError(null)).toBeInstanceOf(DBError);
  });

  test('wraps undefined', function () {
    expect(normalizeDbError(undefined)).toBeInstanceOf(DBError);
  });
});

// Prisma-shaped errors. The meta shapes below are copied from real errors
// observed against prisma 7.9 + adapter-pg (see extractPgDetails); meta is not
// public API, so these tests pin our defensive extraction, not Prisma's
// contract.
describe('normalizeDbError on Prisma errors', function () {
  function knownError(code: string, meta: Record<string, unknown> | undefined) {
    return new Prisma.PrismaClientKnownRequestError('prisma failure', {
      code,
      clientVersion: 'test',
      meta,
    });
  }

  function driverMeta(originalCode: string, originalMessage: string) {
    return {
      driverAdapterError: {
        name: 'DriverAdapterError',
        cause: { originalCode, originalMessage },
      },
    };
  }

  test('maps P2002 to DBUniqueViolationError with SQLSTATE code', function () {
    const result = normalizeDbError(knownError('P2002', undefined));
    expect(result).toBeInstanceOf(DBUniqueViolationError);
    expect((result as DBUniqueViolationError).code).toBe('23505');
    expect((result as DBUniqueViolationError).constraint).toBeUndefined();
  });

  test('recovers the constraint name from the driver originalMessage', function () {
    const result = normalizeDbError(
      knownError(
        'P2002',
        driverMeta(
          '23505',
          'duplicate key value violates unique constraint "user_uniq_org_id_email"'
        )
      )
    );
    expect((result as DBUniqueViolationError).constraint).toBe(
      'user_uniq_org_id_email'
    );
  });

  test('maps a raw-query 23505 (P2010 + originalCode) to DBUniqueViolationError', function () {
    const result = normalizeDbError(
      knownError(
        'P2010',
        driverMeta(
          '23505',
          'duplicate key value violates unique constraint "org_pkey"'
        )
      )
    );
    expect(result).toBeInstanceOf(DBUniqueViolationError);
    expect((result as DBUniqueViolationError).code).toBe('23505');
    expect((result as DBUniqueViolationError).constraint).toBe('org_pkey');
  });

  test('maps a raw-query error with a non-unique SQLSTATE to DBError carrying it', function () {
    const result = normalizeDbError(
      knownError(
        'P2010',
        driverMeta('42P01', 'relation "_prisma_migrations" does not exist')
      )
    );
    expect(result).toBeInstanceOf(DBError);
    expect(result).not.toBeInstanceOf(DBUniqueViolationError);
    expect((result as DBError).code).toBe('42P01');
  });

  test('falls back to the Prisma code when no SQLSTATE is recoverable', function () {
    const result = normalizeDbError(knownError('P2025', undefined));
    expect(result).toBeInstanceOf(DBError);
    expect((result as DBError).code).toBe('P2025');
  });
});

describe('DB error hierarchy', function () {
  test('DBUniqueViolationError extends DBError extends AppError; carries code', function () {
    const err = new DBUniqueViolationError('boom', 'c', '23505');
    expect(err).toBeInstanceOf(DBError);
    expect(err).toBeInstanceOf(AppError);
    expect(err.name).toBe('DBUniqueViolationError');
    expect(err.code).toBe('23505');
    expect(err.constraint).toBe('c');
  });

  test('DBError defaults code to undefined', function () {
    const err = new DBError('boom');
    expect(err.code).toBeUndefined();
    expect(err.name).toBe('DBError');
  });
});
