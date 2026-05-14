import { describe, expect, test } from 'bun:test';
import { sanitizeSlug } from '../slug.ts';

describe('sanitizeSlug', function () {
  test('lowercases and replaces non-[a-z0-9_-] runs with single underscore', function () {
    expect(sanitizeSlug('Add Users!!')).toBe('add_users');
  });

  test('preserves underscores and hyphens', function () {
    expect(sanitizeSlug('add_user-table')).toBe('add_user-table');
  });

  test('trims leading and trailing underscores', function () {
    expect(sanitizeSlug('__foo__')).toBe('foo');
  });

  test('trims leading and trailing hyphens', function () {
    expect(sanitizeSlug('---foo---')).toBe('foo');
  });

  test('trims mixed leading/trailing separators', function () {
    expect(sanitizeSlug('-_-foo-_-')).toBe('foo');
  });

  test('returns null when nothing usable remains', function () {
    expect(sanitizeSlug('!!!')).toBeNull();
    expect(sanitizeSlug('')).toBeNull();
  });

  test('handles a typical branch input', function () {
    expect(sanitizeSlug('kylemuldoon15/rep-39-foo')).toBe(
      'kylemuldoon15_rep-39-foo'
    );
  });

  test('collapses runs of mixed disallowed chars into one underscore', function () {
    expect(sanitizeSlug('foo...bar')).toBe('foo_bar');
  });

  test('preserves runs of hyphens (allowed)', function () {
    expect(sanitizeSlug('foo---bar')).toBe('foo---bar');
  });
});
