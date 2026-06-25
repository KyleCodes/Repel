import { afterEach, describe, expect, test } from 'bun:test';
import { resolveLogFormat, resolveLogLevel } from '../env';

const originalLevel = process.env.LOG_LEVEL;
const originalFormat = process.env.LOG_FORMAT;

afterEach(function () {
  if (originalLevel === undefined) delete process.env.LOG_LEVEL;
  else process.env.LOG_LEVEL = originalLevel;
  if (originalFormat === undefined) delete process.env.LOG_FORMAT;
  else process.env.LOG_FORMAT = originalFormat;
});

describe('resolveLogLevel', function () {
  test('defaults to info when LOG_LEVEL is absent', function () {
    delete process.env.LOG_LEVEL;
    expect(resolveLogLevel()).toBe('info');
  });

  test('respects a valid process.env.LOG_LEVEL', function () {
    process.env.LOG_LEVEL = 'debug';
    expect(resolveLogLevel()).toBe('debug');
  });

  test('falls back to info on an invalid LOG_LEVEL', function () {
    process.env.LOG_LEVEL = 'loud';
    expect(resolveLogLevel()).toBe('info');
  });

  test('does not throw when env is absent', function () {
    delete process.env.LOG_LEVEL;
    expect(() => resolveLogLevel()).not.toThrow();
  });
});

describe('resolveLogFormat', function () {
  test('returns undefined when LOG_FORMAT is absent', function () {
    delete process.env.LOG_FORMAT;
    expect(resolveLogFormat()).toBeUndefined();
  });

  test('returns json when LOG_FORMAT=json', function () {
    process.env.LOG_FORMAT = 'json';
    expect(resolveLogFormat()).toBe('json');
  });

  test('returns pretty when LOG_FORMAT=pretty', function () {
    process.env.LOG_FORMAT = 'pretty';
    expect(resolveLogFormat()).toBe('pretty');
  });

  test('returns undefined for an unrecognized LOG_FORMAT', function () {
    process.env.LOG_FORMAT = 'xml';
    expect(resolveLogFormat()).toBeUndefined();
  });
});
