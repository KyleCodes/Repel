import { describe, expect, test } from 'bun:test';
import { AppError } from '../../../lib/error.ts';
import { DBError, DBUniqueViolationError, normalizeDbError } from '../error.ts';

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
