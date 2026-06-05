import { describe, expect, test } from 'bun:test';
import { HttpResponseError } from '../../../../lib/http/error.ts';
import { buildAuthUrl, exchangeCode, refreshTokens } from '../flow.ts';
import type { OAuth2Config } from '../types.ts';

const config: OAuth2Config = {
  clientId: 'client-123',
  clientSecret: 'secret-456',
  authEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
  redirectUri: 'http://127.0.0.1:54321/',
  extraAuthParams: { access_type: 'offline', prompt: 'consent' },
};

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('buildAuthUrl', function () {
  test('encodes all required authorization-code + PKCE params', function () {
    const url = buildAuthUrl({
      config,
      state: 'state-abc',
      challenge: 'challenge-xyz',
    });
    const parsed = new URL(url);
    expect(`${parsed.origin}${parsed.pathname}`).toBe(config.authEndpoint);
    expect(parsed.searchParams.get('client_id')).toBe('client-123');
    expect(parsed.searchParams.get('redirect_uri')).toBe(config.redirectUri);
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('state')).toBe('state-abc');
    expect(parsed.searchParams.get('code_challenge')).toBe('challenge-xyz');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
  });

  test('sets the scope param from the configured scopes', function () {
    const url = buildAuthUrl({ config, state: 's', challenge: 'c' });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('scope')).toBe(
      'https://www.googleapis.com/auth/gmail.readonly'
    );
  });

  test('appends extraAuthParams (access_type=offline, prompt=consent)', function () {
    const url = buildAuthUrl({ config, state: 's', challenge: 'c' });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('access_type')).toBe('offline');
    expect(parsed.searchParams.get('prompt')).toBe('consent');
  });

  test('never includes the code_verifier', function () {
    const url = buildAuthUrl({ config, state: 's', challenge: 'c' });
    expect(url).not.toContain('code_verifier');
  });
});

describe('exchangeCode', function () {
  test('posts a urlencoded authorization-code grant and maps the TokenSet', async function () {
    let seenBody: URLSearchParams | undefined;
    let seenUrl: string | undefined;
    const before = Date.now();
    const fetchImpl = async function (url: string, init?: RequestInit) {
      seenUrl = url;
      seenBody = init?.body as URLSearchParams;
      return jsonResponse({
        access_token: 'at-1',
        refresh_token: 'rt-1',
        expires_in: 3600,
        scope: 'https://www.googleapis.com/auth/gmail.readonly',
        token_type: 'Bearer',
      });
    };
    const tokens = await exchangeCode(
      { config, code: 'auth-code-1', verifier: 'verifier-1' },
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );

    expect(seenUrl).toBe(config.tokenEndpoint);
    expect(seenBody?.get('grant_type')).toBe('authorization_code');
    expect(seenBody?.get('code')).toBe('auth-code-1');
    expect(seenBody?.get('code_verifier')).toBe('verifier-1');
    expect(seenBody?.get('redirect_uri')).toBe(config.redirectUri);
    expect(seenBody?.get('client_id')).toBe('client-123');
    expect(seenBody?.get('client_secret')).toBe('secret-456');

    expect(tokens.accessToken).toBe('at-1');
    expect(tokens.refreshToken).toBe('rt-1');
    expect(tokens.tokenType).toBe('Bearer');
    expect(tokens.scope).toBe('https://www.googleapis.com/auth/gmail.readonly');
    expect(tokens.expiresAt).toBeGreaterThanOrEqual(before + 3600 * 1000);
    expect(tokens.expiresAt).toBeLessThanOrEqual(Date.now() + 3600 * 1000);
    // epoch ms is ~13 digits — catches a missing *1000 conversion.
    expect(String(tokens.expiresAt).length).toBeGreaterThanOrEqual(13);
  });

  test('tolerates a token response without a refresh_token', async function () {
    const fetchImpl = async function () {
      return jsonResponse({
        access_token: 'at-2',
        expires_in: 3600,
        token_type: 'Bearer',
      });
    };
    const tokens = await exchangeCode(
      { config, code: 'c', verifier: 'v' },
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );
    expect(tokens.refreshToken).toBeUndefined();
  });

  test('the redirect_uri byte-matches the auth URL redirect_uri', async function () {
    const authUrl = new URL(
      buildAuthUrl({ config, state: 's', challenge: 'c' })
    );
    let seenBody: URLSearchParams | undefined;
    const fetchImpl = async function (_url: string, init?: RequestInit) {
      seenBody = init?.body as URLSearchParams;
      return jsonResponse({
        access_token: 'at',
        expires_in: 60,
        token_type: 'Bearer',
      });
    };
    await exchangeCode(
      { config, code: 'c', verifier: 'v' },
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );
    expect(seenBody?.get('redirect_uri')).toBe(
      authUrl.searchParams.get('redirect_uri')
    );
  });

  test('surfaces a 400 token error as HttpResponseError', async function () {
    const fetchImpl = async function () {
      return jsonResponse({ error: 'invalid_grant' }, { status: 400 });
    };
    let caught: unknown;
    try {
      await exchangeCode(
        { config, code: 'c', verifier: 'v' },
        { fetchImpl: fetchImpl as unknown as typeof fetch }
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(HttpResponseError);
    expect((caught as HttpResponseError).status).toBe(400);
  });
});

describe('refreshTokens', function () {
  test('posts a refresh_token grant', async function () {
    let seenBody: URLSearchParams | undefined;
    const fetchImpl = async function (_url: string, init?: RequestInit) {
      seenBody = init?.body as URLSearchParams;
      return jsonResponse({
        access_token: 'at-new',
        expires_in: 3600,
        token_type: 'Bearer',
      });
    };
    const tokens = await refreshTokens(
      { config, refreshToken: 'rt-existing' },
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );
    expect(seenBody?.get('grant_type')).toBe('refresh_token');
    expect(seenBody?.get('refresh_token')).toBe('rt-existing');
    expect(tokens.accessToken).toBe('at-new');
  });

  test('preserves the passed-in refresh token when the response omits one', async function () {
    const fetchImpl = async function () {
      return jsonResponse({
        access_token: 'at-new',
        expires_in: 3600,
        token_type: 'Bearer',
      });
    };
    const tokens = await refreshTokens(
      { config, refreshToken: 'rt-existing' },
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );
    expect(tokens.refreshToken).toBe('rt-existing');
  });
});
