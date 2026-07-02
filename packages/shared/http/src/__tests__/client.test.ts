import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { httpRequest } from '../client';
import { HttpNetworkError, HttpResponseError } from '../error';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

function asFetch(fn: (url: string, init?: RequestInit) => Promise<Response>) {
  return fn as unknown as typeof fetch;
}

describe('httpRequest', function () {
  test('parses and returns json when no schema given', async function () {
    const fetchImpl = asFetch(async function () {
      return jsonResponse({ hello: 'world' });
    });
    const result = await httpRequest<{ hello: string }>(
      { url: 'https://api/x' },
      { fetchImpl }
    );
    expect(result).toEqual({ hello: 'world' });
  });

  test('validates the response against a schema when given', async function () {
    const schema = z.object({ emailAddress: z.string() });
    const fetchImpl = asFetch(async function () {
      return jsonResponse({ emailAddress: 'a@b.com', extra: 1 });
    });
    const result = await httpRequest(
      { url: 'https://api/profile', schema },
      { fetchImpl }
    );
    expect(result.emailAddress).toBe('a@b.com');
  });

  test('propagates a raw ZodError on schema mismatch (no Http wrapper)', async function () {
    const schema = z.object({ emailAddress: z.string() });
    const fetchImpl = asFetch(async function () {
      return jsonResponse({ wrong: true });
    });
    let caught: unknown;
    try {
      await httpRequest({ url: 'https://api/profile', schema }, { fetchImpl });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(z.ZodError);
  });

  test('defaults method to GET', async function () {
    let seenMethod: string | undefined;
    const fetchImpl = asFetch(async function (_url, init) {
      seenMethod = (init?.method ?? 'GET').toUpperCase();
      return jsonResponse({});
    });
    await httpRequest({ url: 'https://api/x' }, { fetchImpl });
    expect(seenMethod).toBe('GET');
  });

  test('appends params as a urlencoded querystring', async function () {
    let seenUrl: string | undefined;
    const fetchImpl = asFetch(async function (url) {
      seenUrl = url;
      return jsonResponse({});
    });
    await httpRequest(
      { url: 'https://api/search', params: { q: 'a b', page: '2' } },
      { fetchImpl }
    );
    const parsed = new URL(seenUrl!);
    expect(parsed.searchParams.get('q')).toBe('a b');
    expect(parsed.searchParams.get('page')).toBe('2');
  });

  test('encodes a json body with application/json content-type', async function () {
    let seenBody: string | undefined;
    let seenContentType: string | undefined;
    const fetchImpl = asFetch(async function (_url, init) {
      seenBody = init?.body as string;
      seenContentType =
        new Headers(init?.headers).get('content-type') ?? undefined;
      return jsonResponse({});
    });
    await httpRequest(
      { method: 'POST', url: 'https://api/x', body: { a: 1 } },
      { fetchImpl }
    );
    expect(seenContentType).toBe('application/json');
    expect(JSON.parse(seenBody!)).toEqual({ a: 1 });
  });

  test('encodes a form body as urlencoded with form content-type', async function () {
    let seenBody: unknown;
    let seenContentType: string | undefined;
    const fetchImpl = asFetch(async function (_url, init) {
      seenBody = init?.body;
      seenContentType =
        new Headers(init?.headers).get('content-type') ?? undefined;
      return jsonResponse({});
    });
    await httpRequest(
      {
        method: 'POST',
        url: 'https://api/token',
        encoding: 'form',
        body: { grant_type: 'authorization_code', code: 'abc' },
      },
      { fetchImpl }
    );
    expect(seenContentType).toBe('application/x-www-form-urlencoded');
    expect(seenBody).toBeInstanceOf(URLSearchParams);
    const params = seenBody as URLSearchParams;
    expect(params.get('grant_type')).toBe('authorization_code');
    expect(params.get('code')).toBe('abc');
  });

  test('forwards custom headers', async function () {
    let seenAuth: string | undefined;
    const fetchImpl = asFetch(async function (_url, init) {
      seenAuth = new Headers(init?.headers).get('authorization') ?? undefined;
      return jsonResponse({});
    });
    await httpRequest(
      { url: 'https://api/x', headers: { authorization: 'Bearer tok' } },
      { fetchImpl }
    );
    expect(seenAuth).toBe('Bearer tok');
  });

  test('throws HttpResponseError on a non-2xx status carrying status/url/body', async function () {
    const fetchImpl = asFetch(async function () {
      return jsonResponse({ error: 'invalid_grant' }, { status: 400 });
    });
    let caught: unknown;
    try {
      await httpRequest({ url: 'https://oauth2/token' }, { fetchImpl });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(HttpResponseError);
    const err = caught as HttpResponseError;
    expect(err.status).toBe(400);
    expect(err.url).toBe('https://oauth2/token');
    expect(err.body).toEqual({ error: 'invalid_grant' });
  });

  test('falls back to text body when an error response is not json', async function () {
    // 503 is retryable; maxRetries:0 asserts the terminal throw shape without
    // waiting on backoff.
    const fetchImpl = asFetch(async function () {
      return new Response('plain failure', { status: 503 });
    });
    let caught: unknown;
    try {
      await httpRequest({ url: 'https://api/x' }, { fetchImpl, maxRetries: 0 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(HttpResponseError);
    expect((caught as HttpResponseError).body).toBe('plain failure');
  });

  test('wraps a fetch TypeError as HttpNetworkError with the cause', async function () {
    const cause = new TypeError('fetch failed');
    const fetchImpl = asFetch(async function () {
      throw cause;
    });
    let caught: unknown;
    try {
      await httpRequest({ url: 'https://api/x' }, { fetchImpl, maxRetries: 0 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(HttpNetworkError);
    expect((caught as HttpNetworkError).cause).toBe(cause);
  });
});

describe('httpRequest — retry/backoff', function () {
  // A sleep seam that records delays and never actually waits.
  function recordingSleep() {
    const delays: number[] = [];
    const sleep = async function (ms: number): Promise<void> {
      delays.push(ms);
    };
    return { delays, sleep };
  }

  test('retries a 429 then succeeds', async function () {
    let calls = 0;
    const fetchImpl = asFetch(async function () {
      calls += 1;
      if (calls === 1) return jsonResponse({ e: 1 }, { status: 429 });
      return jsonResponse({ ok: true });
    });
    const { delays, sleep } = recordingSleep();
    const result = await httpRequest<{ ok: boolean }>(
      { url: 'https://api/x' },
      { fetchImpl, sleep }
    );
    expect(result).toEqual({ ok: true });
    expect(calls).toBe(2);
    expect(delays).toHaveLength(1); // one backoff between the two attempts
  });

  test('retries a 5xx then succeeds', async function () {
    let calls = 0;
    const fetchImpl = asFetch(async function () {
      calls += 1;
      if (calls === 1) return new Response('x', { status: 500 });
      return jsonResponse({ ok: true });
    });
    const { sleep } = recordingSleep();
    await httpRequest({ url: 'https://api/x' }, { fetchImpl, sleep });
    expect(calls).toBe(2);
  });

  test('retries a network throw then succeeds', async function () {
    let calls = 0;
    const fetchImpl = asFetch(async function () {
      calls += 1;
      if (calls === 1) throw new TypeError('boom');
      return jsonResponse({ ok: true });
    });
    const { sleep } = recordingSleep();
    await httpRequest({ url: 'https://api/x' }, { fetchImpl, sleep });
    expect(calls).toBe(2);
  });

  test('retries a quota-flavored 403 (rateLimitExceeded body)', async function () {
    let calls = 0;
    const fetchImpl = asFetch(async function () {
      calls += 1;
      if (calls === 1) {
        return jsonResponse(
          { error: { code: 403, message: 'Quota exceeded for quota metric' } },
          { status: 403 }
        );
      }
      return jsonResponse({ ok: true });
    });
    const { sleep } = recordingSleep();
    await httpRequest({ url: 'https://api/x' }, { fetchImpl, sleep });
    expect(calls).toBe(2);
  });

  test('does NOT retry a non-quota 403 (auth) — throws immediately', async function () {
    let calls = 0;
    const fetchImpl = asFetch(async function () {
      calls += 1;
      return jsonResponse(
        { error: { code: 403, message: 'Request had insufficient scopes' } },
        { status: 403 }
      );
    });
    const { sleep } = recordingSleep();
    let caught: unknown;
    try {
      await httpRequest({ url: 'https://api/x' }, { fetchImpl, sleep });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(HttpResponseError);
    expect(calls).toBe(1);
  });

  test('does NOT retry a 404', async function () {
    let calls = 0;
    const fetchImpl = asFetch(async function () {
      calls += 1;
      return new Response('nope', { status: 404 });
    });
    const { sleep } = recordingSleep();
    await httpRequest({ url: 'https://api/x' }, { fetchImpl, sleep }).catch(
      () => {}
    );
    expect(calls).toBe(1);
  });

  test('never retries a ZodError (schema mismatch on a 200)', async function () {
    let calls = 0;
    const schema = z.object({ emailAddress: z.string() });
    const fetchImpl = asFetch(async function () {
      calls += 1;
      return jsonResponse({ wrong: true });
    });
    const { sleep } = recordingSleep();
    await httpRequest(
      { url: 'https://api/x', schema },
      { fetchImpl, sleep }
    ).catch(() => {});
    expect(calls).toBe(1);
  });

  test('honors Retry-After (delta-seconds) for the backoff delay', async function () {
    let calls = 0;
    const fetchImpl = asFetch(async function () {
      calls += 1;
      if (calls === 1) {
        return jsonResponse(
          { e: 1 },
          {
            status: 429,
            headers: { 'retry-after': '2' },
          }
        );
      }
      return jsonResponse({ ok: true });
    });
    const { delays, sleep } = recordingSleep();
    await httpRequest({ url: 'https://api/x' }, { fetchImpl, sleep });
    expect(delays[0]).toBe(2000);
  });

  test('exhausts retries and throws, surfacing retryAfterMs on the error', async function () {
    const fetchImpl = asFetch(async function () {
      return jsonResponse(
        { e: 1 },
        {
          status: 429,
          headers: { 'retry-after': '1' },
        }
      );
    });
    const { sleep } = recordingSleep();
    let caught: unknown;
    try {
      await httpRequest(
        { url: 'https://api/x' },
        { fetchImpl, sleep, maxRetries: 2 }
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(HttpResponseError);
    expect((caught as HttpResponseError).status).toBe(429);
    expect((caught as HttpResponseError).retryAfterMs).toBe(1000);
  });

  test('maxRetries:0 disables retry (single attempt on a 429)', async function () {
    let calls = 0;
    const fetchImpl = asFetch(async function () {
      calls += 1;
      return jsonResponse({ e: 1 }, { status: 429 });
    });
    await httpRequest(
      { url: 'https://api/x' },
      { fetchImpl, maxRetries: 0 }
    ).catch(() => {});
    expect(calls).toBe(1);
  });
});
