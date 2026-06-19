import { describe, expect, test } from 'bun:test';
import { AppError } from '@repel/errors';
import {
  OAuth2DeniedError,
  OAuth2Error,
  OAuth2StateMismatchError,
  OAuth2TimeoutError,
} from '../error';

describe('OAuth2 errors', function () {
  test('OAuth2Error extends AppError', function () {
    const err = new OAuth2Error('boom');
    expect(err).toBeInstanceOf(OAuth2Error);
    expect(err).toBeInstanceOf(AppError);
    expect(err.name).toBe('OAuth2Error');
  });

  test('OAuth2StateMismatchError extends OAuth2Error', function () {
    const err = new OAuth2StateMismatchError('state mismatch');
    expect(err).toBeInstanceOf(OAuth2StateMismatchError);
    expect(err).toBeInstanceOf(OAuth2Error);
    expect(err.name).toBe('OAuth2StateMismatchError');
  });

  test('OAuth2TimeoutError extends OAuth2Error', function () {
    const err = new OAuth2TimeoutError('timed out');
    expect(err).toBeInstanceOf(OAuth2TimeoutError);
    expect(err).toBeInstanceOf(OAuth2Error);
    expect(err.name).toBe('OAuth2TimeoutError');
  });

  test('OAuth2DeniedError extends OAuth2Error', function () {
    const err = new OAuth2DeniedError('access_denied');
    expect(err).toBeInstanceOf(OAuth2DeniedError);
    expect(err).toBeInstanceOf(OAuth2Error);
    expect(err.name).toBe('OAuth2DeniedError');
  });
});
