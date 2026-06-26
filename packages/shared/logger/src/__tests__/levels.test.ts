import { describe, expect, test } from 'bun:test';
import { LEVEL_WEIGHTS, meetsThreshold, resolveThreshold } from '../levels';

describe('LEVEL_WEIGHTS', function () {
  test('orders debug < info < warn < error', function () {
    expect(LEVEL_WEIGHTS.debug).toBeLessThan(LEVEL_WEIGHTS.info);
    expect(LEVEL_WEIGHTS.info).toBeLessThan(LEVEL_WEIGHTS.warn);
    expect(LEVEL_WEIGHTS.warn).toBeLessThan(LEVEL_WEIGHTS.error);
  });
});

describe('resolveThreshold', function () {
  test('returns a valid raw level unchanged', function () {
    expect(resolveThreshold('debug', 'info')).toBe('debug');
    expect(resolveThreshold('warn', 'info')).toBe('warn');
  });

  test('falls back when raw is undefined', function () {
    expect(resolveThreshold(undefined, 'warn')).toBe('warn');
  });

  test('falls back when raw is not a valid level', function () {
    expect(resolveThreshold('verbose', 'info')).toBe('info');
    expect(resolveThreshold('', 'error')).toBe('error');
  });
});

describe('meetsThreshold', function () {
  test('true when level weight >= threshold weight', function () {
    expect(meetsThreshold('error', 'warn')).toBe(true);
    expect(meetsThreshold('warn', 'warn')).toBe(true);
  });

  test('false when level weight < threshold weight', function () {
    expect(meetsThreshold('debug', 'info')).toBe(false);
    expect(meetsThreshold('info', 'error')).toBe(false);
  });
});
