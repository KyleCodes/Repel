import { describe, expect, test } from 'bun:test';
import { isBrowser, isTTY } from '../runtime';

describe('isBrowser', function () {
  test('false in the Bun test runtime (no window/document)', function () {
    expect(isBrowser()).toBe(false);
  });
});

describe('isTTY', function () {
  test('returns a boolean (reads process.stderr)', function () {
    expect(typeof isTTY()).toBe('boolean');
  });
});
