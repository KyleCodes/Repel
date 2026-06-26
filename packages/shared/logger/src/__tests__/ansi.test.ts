import { describe, expect, test } from 'bun:test';
import { ANSI, colorForLevel, paint } from '../ansi';

describe('paint', function () {
  test('wraps the string in the code and a reset', function () {
    expect(paint(ANSI.red, 'hi')).toBe(`${ANSI.red}hi${ANSI.reset}`);
  });
});

describe('colorForLevel', function () {
  test('maps levels to colors', function () {
    expect(colorForLevel('error')).toBe(ANSI.red);
    expect(colorForLevel('warn')).toBe(ANSI.yellow);
    expect(colorForLevel('info')).toBe(ANSI.white);
    expect(colorForLevel('debug')).toContain(ANSI.dim);
  });
});
