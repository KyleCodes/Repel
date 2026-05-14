import { describe, expect, test } from 'bun:test';
import { sanitizeBranchToDbName } from '../service.ts';

describe('sanitizeBranchToDbName', function () {
  test('ticket-shaped names keep their hyphen', function () {
    expect(sanitizeBranchToDbName('REP-99')).toBe('repel_rep-99');
  });

  test('slashes collapse to underscores; hyphens preserved', function () {
    expect(sanitizeBranchToDbName('REP-7/some-feature')).toBe(
      'repel_rep-7_some-feature'
    );
  });

  test('runs of non-[a-z0-9_-] collapse to a single underscore; runs of hyphens preserved', function () {
    expect(sanitizeBranchToDbName('foo---bar...baz')).toBe(
      'repel_foo---bar_baz'
    );
  });

  test('leading and trailing separators are trimmed', function () {
    expect(sanitizeBranchToDbName('---foo---')).toBe('repel_foo');
  });

  test('uppercase normalized to lowercase', function () {
    expect(sanitizeBranchToDbName('FOO')).toBe('repel_foo');
  });

  test('throws when slug is empty after sanitize', function () {
    expect(function () {
      sanitizeBranchToDbName('---');
    }).toThrow('branch "---" produced an empty database slug');
  });
});
