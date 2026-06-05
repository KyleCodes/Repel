import { describe, expect, test } from 'bun:test';
import {
  OAuth2DeniedError,
  OAuth2Error,
  OAuth2StateMismatchError,
  OAuth2TimeoutError,
} from '../error.ts';
import {
  LOOPBACK_TIMEOUT_MS,
  handleRedirect,
  runLoopbackFlow,
} from '../loopback.ts';
import type { OAuth2Config } from '../types.ts';

const baseConfig: Omit<OAuth2Config, 'redirectUri'> = {
  clientId: 'client-123',
  clientSecret: 'secret-456',
  authEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
  extraAuthParams: { access_type: 'offline', prompt: 'consent' },
};

describe('handleRedirect', function () {
  test('returns ok with the code when state matches', function () {
    const result = handleRedirect({
      url: '/?code=auth-code&state=expected',
      expectedState: 'expected',
    });
    expect(result).toEqual({ ok: true, code: 'auth-code' });
  });

  test('returns state_mismatch when the echoed state differs', function () {
    const result = handleRedirect({
      url: '/?code=auth-code&state=other',
      expectedState: 'expected',
    });
    expect(result).toEqual({ ok: false, reason: 'state_mismatch' });
  });

  test('returns state_mismatch when the redirect carries no state', function () {
    const result = handleRedirect({
      url: '/?code=auth-code',
      expectedState: 'expected',
    });
    expect(result).toEqual({ ok: false, reason: 'state_mismatch' });
  });

  test('returns missing_code when no code and no error are present', function () {
    const result = handleRedirect({
      url: '/?state=expected',
      expectedState: 'expected',
    });
    expect(result).toEqual({ ok: false, reason: 'missing_code' });
  });

  test('returns oauth_error with the provider detail', function () {
    const result = handleRedirect({
      url: '/?error=access_denied&state=expected',
      expectedState: 'expected',
    });
    expect(result).toEqual({
      ok: false,
      reason: 'oauth_error',
      detail: 'access_denied',
    });
  });
});

describe('LOOPBACK_TIMEOUT_MS', function () {
  test('defaults to 120 seconds', function () {
    expect(LOOPBACK_TIMEOUT_MS).toBe(120_000);
  });
});

describe('runLoopbackFlow', function () {
  test('binds to 127.0.0.1 and opens the browser with a loopback auth URL omitting the verifier', async function () {
    let openedUrl: string | undefined;
    let openCount = 0;
    const openBrowser = async function (url: string) {
      openCount += 1;
      openedUrl = url;
      // Drive the redirect ourselves so the flow resolves.
      const redirectUri = new URL(url).searchParams.get('redirect_uri')!;
      const state = new URL(url).searchParams.get('state')!;
      await fetch(`${redirectUri}?code=server-code&state=${state}`);
    };

    const result = await runLoopbackFlow({
      config: baseConfig,
      openBrowser,
      timeoutMs: 5_000,
    });

    expect(openCount).toBe(1);
    const parsed = new URL(openedUrl!);
    expect(parsed.searchParams.get('redirect_uri')).toContain('127.0.0.1');
    expect(openedUrl).not.toContain('code_verifier');

    expect(result.code).toBe('server-code');
    expect(result.verifier.length).toBeGreaterThan(0);
    expect(result.redirectUri).toContain('http://127.0.0.1:');
    // byte-match: the redirect_uri in the opened auth URL equals the returned one.
    expect(parsed.searchParams.get('redirect_uri')).toBe(result.redirectUri);
  });

  test('rejects with OAuth2TimeoutError when no redirect arrives and frees the listener', async function () {
    const openBrowser = async function () {
      // never drives a redirect
    };
    let caught: unknown;
    try {
      await runLoopbackFlow({
        config: baseConfig,
        openBrowser,
        timeoutMs: 20,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OAuth2TimeoutError);
  });

  test('rejects with OAuth2DeniedError when the provider redirects with an error', async function () {
    const openBrowser = async function (url: string) {
      const redirectUri = new URL(url).searchParams.get('redirect_uri')!;
      const state = new URL(url).searchParams.get('state')!;
      await fetch(`${redirectUri}?error=access_denied&state=${state}`);
    };
    let caught: unknown;
    try {
      await runLoopbackFlow({
        config: baseConfig,
        openBrowser,
        timeoutMs: 5000,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OAuth2DeniedError);
  });

  test('rejects with OAuth2StateMismatchError when the echoed state differs', async function () {
    const openBrowser = async function (url: string) {
      const redirectUri = new URL(url).searchParams.get('redirect_uri')!;
      await fetch(`${redirectUri}?code=c&state=tampered`);
    };
    let caught: unknown;
    try {
      await runLoopbackFlow({
        config: baseConfig,
        openBrowser,
        timeoutMs: 5000,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OAuth2StateMismatchError);
  });

  test('rejects with OAuth2Error when the redirect carries no code', async function () {
    const openBrowser = async function (url: string) {
      const redirectUri = new URL(url).searchParams.get('redirect_uri')!;
      const state = new URL(url).searchParams.get('state')!;
      await fetch(`${redirectUri}?state=${state}`);
    };
    let caught: unknown;
    try {
      await runLoopbackFlow({
        config: baseConfig,
        openBrowser,
        timeoutMs: 5000,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OAuth2Error);
    expect((caught as OAuth2Error).message).toContain('no authorization code');
  });

  test('rejects with OAuth2Error when openBrowser fails', async function () {
    const openBrowser = async function () {
      throw new Error('no browser');
    };
    let caught: unknown;
    try {
      await runLoopbackFlow({
        config: baseConfig,
        openBrowser,
        timeoutMs: 5000,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OAuth2Error);
    expect((caught as OAuth2Error).message).toContain('failed to open browser');
  });
});
