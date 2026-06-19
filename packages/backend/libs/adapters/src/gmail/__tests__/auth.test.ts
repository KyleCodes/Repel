import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { HttpResponseError } from '@repel/http/error';
import { OAuth2StateMismatchError } from '../../lib/oauth2/error';
import { gmailAuth } from '../auth';
import { GMAIL_TOKEN_ENDPOINT } from '../oauth';

let originalId: string | undefined;
let originalSecret: string | undefined;

beforeEach(function () {
  originalId = process.env.REPEL_GMAIL_CLIENT_ID;
  originalSecret = process.env.REPEL_GMAIL_CLIENT_SECRET;
  process.env.REPEL_GMAIL_CLIENT_ID = 'id-123';
  process.env.REPEL_GMAIL_CLIENT_SECRET = 'secret-456';
});

afterEach(function () {
  if (originalId === undefined) delete process.env.REPEL_GMAIL_CLIENT_ID;
  else process.env.REPEL_GMAIL_CLIENT_ID = originalId;
  if (originalSecret === undefined)
    delete process.env.REPEL_GMAIL_CLIENT_SECRET;
  else process.env.REPEL_GMAIL_CLIENT_SECRET = originalSecret;
});

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

// Branch a stub fetch on URL: the token endpoint vs the profile endpoint.
function asFetch(
  handler: (url: string, init?: RequestInit) => Promise<Response>
): typeof fetch {
  return handler as unknown as typeof fetch;
}

const ctx = {
  provider: 'gmail' as const,
  orgId: 'org-1',
  userId: 'user-1',
  redirectUri: 'http://127.0.0.1:5555/',
};

describe('gmailAuth.authorize', function () {
  test('builds a consent URL with code_challenge, S256, and state, but no code_verifier', async function () {
    const authorized = await gmailAuth.authorize(ctx);
    const url = new URL(authorized.authUrl);
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe(authorized.state);
    expect(url.searchParams.has('code_verifier')).toBe(false);
    expect(authorized.authUrl).not.toContain('code_verifier');
  });

  test('echoes the ctx redirectUri into the consent URL', async function () {
    const authorized = await gmailAuth.authorize(ctx);
    const url = new URL(authorized.authUrl);
    expect(url.searchParams.get('redirect_uri')).toBe(ctx.redirectUri);
  });

  test('returns a non-empty pkceVerifier that is absent from the URL', async function () {
    const authorized = await gmailAuth.authorize(ctx);
    expect(authorized.pkceVerifier.length).toBeGreaterThan(0);
    expect(authorized.authUrl).not.toContain(authorized.pkceVerifier);
  });
});

describe('gmailAuth.exchange', function () {
  test('throws OAuth2StateMismatchError when state !== expectedState (fetch never called)', async function () {
    let fetchCalled = false;
    const fetchImpl = asFetch(async function () {
      fetchCalled = true;
      return jsonResponse({});
    });
    let caught: unknown;
    try {
      await gmailAuth.exchange(
        {
          code: 'c',
          state: 'a',
          expectedState: 'b',
          pkceVerifier: 'v',
          redirectUri: ctx.redirectUri,
        },
        { fetchImpl }
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OAuth2StateMismatchError);
    expect(fetchCalled).toBe(false);
  });

  test('exchanges the code then reads the profile, lowercasing the email', async function () {
    const hits: string[] = [];
    let tokenRedirectUri: string | undefined;
    const fetchImpl = asFetch(async function (url: string, init?: RequestInit) {
      hits.push(url);
      if (url === GMAIL_TOKEN_ENDPOINT) {
        const body = new URLSearchParams(String(init?.body));
        tokenRedirectUri = body.get('redirect_uri') ?? undefined;
        return jsonResponse({
          access_token: 'tok-abc',
          expires_in: 3600,
          refresh_token: 'refresh-xyz',
          token_type: 'Bearer',
        });
      }
      // profile endpoint
      return jsonResponse({ emailAddress: 'User@Gmail.com' });
    });

    const result = await gmailAuth.exchange(
      {
        code: 'auth-code',
        state: 's',
        expectedState: 's',
        pkceVerifier: 'verifier',
        redirectUri: ctx.redirectUri,
      },
      { fetchImpl }
    );

    expect(result.externalAccountId).toBe('user@gmail.com');
    expect(result.authMethod).toBe('oauth2');
    expect(result.credentials).toMatchObject({ accessToken: 'tok-abc' });
    // both endpoints hit, in order.
    expect(hits[0]).toBe(GMAIL_TOKEN_ENDPOINT);
    expect(hits[1]).toContain('/gmail/v1/users/me/profile');
    // token POST redirect_uri byte-matches the input.
    expect(tokenRedirectUri).toBe(ctx.redirectUri);
  });

  test('returns credentials even when the token response carries no refresh_token', async function () {
    const fetchImpl = asFetch(async function (url: string) {
      if (url === GMAIL_TOKEN_ENDPOINT) {
        return jsonResponse({
          access_token: 'tok-no-refresh',
          expires_in: 3600,
          token_type: 'Bearer',
        });
      }
      return jsonResponse({ emailAddress: 'a@b.com' });
    });

    const result = await gmailAuth.exchange(
      {
        code: 'c',
        state: 's',
        expectedState: 's',
        pkceVerifier: 'v',
        redirectUri: ctx.redirectUri,
      },
      { fetchImpl }
    );
    expect(result.credentials).toMatchObject({ accessToken: 'tok-no-refresh' });
  });

  test('surfaces a 400 from the token endpoint', async function () {
    const fetchImpl = asFetch(async function () {
      return jsonResponse({ error: 'invalid_grant' }, { status: 400 });
    });
    let caught: unknown;
    try {
      await gmailAuth.exchange(
        {
          code: 'c',
          state: 's',
          expectedState: 's',
          pkceVerifier: 'v',
          redirectUri: ctx.redirectUri,
        },
        { fetchImpl }
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(HttpResponseError);
  });
});
