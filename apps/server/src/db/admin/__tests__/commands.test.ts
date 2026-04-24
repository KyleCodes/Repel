import { describe, expect, test } from 'bun:test';
import { sanitizeBranchToDbName } from '../commands.js';

describe('sanitizeBranchToDbName', function () {
  test('ticket-shaped names', function () {
    expect(sanitizeBranchToDbName('REP-99')).toBe('repel_rep_99');
  });

  test('slashes collapse to underscores', function () {
    expect(sanitizeBranchToDbName('REP-7/some-feature')).toBe('repel_rep_7_some_feature');
  });

  test('runs of non-alphanumerics collapse to a single underscore', function () {
    expect(sanitizeBranchToDbName('foo---bar...baz')).toBe('repel_foo_bar_baz');
  });

  test('leading and trailing non-alphanumerics are trimmed', function () {
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
