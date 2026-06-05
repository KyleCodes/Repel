import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  MissingEnvVarError,
  getOptionalEnvVar,
  getRequiredEnvVar,
} from '../env.ts';
import { AppError } from '../error.ts';

const NAME = 'REPEL_TEST_ENV_VAR';
let original: string | undefined;

beforeEach(function () {
  original = process.env[NAME];
  delete process.env[NAME];
});

afterEach(function () {
  if (original === undefined) delete process.env[NAME];
  else process.env[NAME] = original;
});

describe('getRequiredEnvVar', function () {
  test('returns the value when set', function () {
    process.env[NAME] = 'hello';
    expect(getRequiredEnvVar(NAME)).toBe('hello');
  });

  test('throws MissingEnvVarError when unset', function () {
    expect(function () {
      getRequiredEnvVar(NAME);
    }).toThrow(MissingEnvVarError);
  });

  test('throws MissingEnvVarError when empty', function () {
    process.env[NAME] = '';
    expect(function () {
      getRequiredEnvVar(NAME);
    }).toThrow(MissingEnvVarError);
  });

  test('the thrown error is an AppError naming the variable', function () {
    let caught: unknown;
    try {
      getRequiredEnvVar(NAME);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as MissingEnvVarError).message).toContain(NAME);
    expect((caught as MissingEnvVarError).name).toBe('MissingEnvVarError');
  });
});

describe('getOptionalEnvVar', function () {
  test('returns the value when set', function () {
    process.env[NAME] = 'world';
    expect(getOptionalEnvVar(NAME)).toBe('world');
  });

  test('returns undefined when unset and no fallback', function () {
    expect(getOptionalEnvVar(NAME)).toBeUndefined();
  });

  test('returns the fallback when unset', function () {
    expect(getOptionalEnvVar(NAME, 'fallback')).toBe('fallback');
  });

  test('returns the fallback when empty', function () {
    process.env[NAME] = '';
    expect(getOptionalEnvVar(NAME, 'fallback')).toBe('fallback');
  });
});
