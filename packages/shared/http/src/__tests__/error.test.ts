import { describe, expect, test } from 'bun:test';
import { AppError } from '@repel/errors';
import { HttpError, HttpNetworkError, HttpResponseError } from '../error.ts';

describe('HttpResponseError', function () {
  test('extends HttpError and AppError', function () {
    const err = new HttpResponseError('boom', {
      status: 404,
      url: 'https://x',
      body: { code: 'nope' },
    });
    expect(err).toBeInstanceOf(HttpResponseError);
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(Error);
  });

  test('sets name to the concrete class name', function () {
    const err = new HttpResponseError('boom', {
      status: 500,
      url: 'https://x',
      body: undefined,
    });
    expect(err.name).toBe('HttpResponseError');
  });

  test('carries status, url, and body', function () {
    const err = new HttpResponseError('boom', {
      status: 400,
      url: 'https://api/token',
      body: { error: 'invalid_grant' },
    });
    expect(err.status).toBe(400);
    expect(err.url).toBe('https://api/token');
    expect(err.body).toEqual({ error: 'invalid_grant' });
  });
});

describe('HttpNetworkError', function () {
  test('extends HttpError and carries the cause', function () {
    const cause = new TypeError('fetch failed');
    const err = new HttpNetworkError('network down', { cause });
    expect(err).toBeInstanceOf(HttpNetworkError);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.name).toBe('HttpNetworkError');
    expect(err.cause).toBe(cause);
  });
});
