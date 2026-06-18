import { describe, expect, test } from 'bun:test';
import type {
  OAuth2Auth,
  OAuthExchangeInput,
  ProviderAuthContext,
  ProviderAuthorization,
} from '../../../types.ts';
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

const ctx: ProviderAuthContext = {
  provider: 'gmail',
  orgId: 'org-1',
  userId: 'user-1',
};

const cannedAuthorization: ProviderAuthorization = {
  externalAccountId: 'user@gmail.com',
  authMethod: 'oauth2',
  credentials: { accessToken: 'tok' },
};

// A stub oauth2 auth. `authorize` builds an auth URL from the passed redirectUri so
// the injected openBrowser can drive a redirect against the bound listener;
// `exchange` records its input and returns a canned authorization. Both phases
// are overridable per test.
function makeStubAuth(
  overrides: {
    authorize?: OAuth2Auth['authorize'];
    exchange?: OAuth2Auth['exchange'];
  } = {}
): OAuth2Auth & {
  authorizeCalls: Array<ProviderAuthContext & { redirectUri: string }>;
  exchangeCalls: OAuthExchangeInput[];
} {
  const authorizeCalls: Array<ProviderAuthContext & { redirectUri: string }> =
    [];
  const exchangeCalls: OAuthExchangeInput[] = [];
  return {
    method: 'oauth2',
    authorize:
      overrides.authorize ??
      async function (begCtx) {
        authorizeCalls.push(begCtx);
        const state = 'state-xyz';
        const authUrl = `https://consent.example/auth?redirect_uri=${encodeURIComponent(
          begCtx.redirectUri
        )}&state=${state}`;
        return { authUrl, state, pkceVerifier: 'verifier-abc' };
      },
    exchange:
      overrides.exchange ??
      async function (input) {
        exchangeCalls.push(input);
        return cannedAuthorization;
      },
    authorizeCalls,
    exchangeCalls,
  };
}

// Drive a redirect against the bound listener by parsing the auth URL the stub
// produced. The query params override let denial / tamper / missing-code cases
// reuse the same plumbing.
function driveBrowser(
  extra: (params: { redirectUri: string; state: string }) => string
) {
  return async function (url: string) {
    const parsed = new URL(url);
    const redirectUri = parsed.searchParams.get('redirect_uri')!;
    const state = parsed.searchParams.get('state')!;
    await fetch(`${redirectUri}?${extra({ redirectUri, state })}`);
  };
}

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
  test('returns the authorization from exchange; opens the browser once; authorize gets a loopback redirectUri', async function () {
    const auth = makeStubAuth();
    let openCount = 0;
    const openBrowser = async function (url: string) {
      openCount += 1;
      await driveBrowser(function ({ state }) {
        return `code=server-code&state=${state}`;
      })(url);
    };

    const result = await runLoopbackFlow(auth, ctx, {
      openBrowser,
      timeoutMs: 5_000,
    });

    expect(result).toEqual(cannedAuthorization);
    expect(openCount).toBe(1);
    expect(auth.authorizeCalls).toHaveLength(1);
    expect(auth.authorizeCalls[0].redirectUri).toStartWith('http://127.0.0.1:');
    // authorize sees the full provider context.
    expect(auth.authorizeCalls[0].provider).toBe('gmail');
    expect(auth.authorizeCalls[0].orgId).toBe('org-1');
    expect(auth.authorizeCalls[0].userId).toBe('user-1');
  });

  test('threads the same redirectUri into authorize and exchange and forwards code/state/verifier', async function () {
    const auth = makeStubAuth();
    const openBrowser = driveBrowser(function ({ state }) {
      return `code=server-code&state=${state}`;
    });

    await runLoopbackFlow(auth, ctx, { openBrowser, timeoutMs: 5_000 });

    expect(auth.exchangeCalls).toHaveLength(1);
    const exchangeInput = auth.exchangeCalls[0];
    expect(exchangeInput.redirectUri).toBe(auth.authorizeCalls[0].redirectUri);
    expect(exchangeInput.code).toBe('server-code');
    expect(exchangeInput.state).toBe('state-xyz');
    expect(exchangeInput.expectedState).toBe('state-xyz');
    expect(exchangeInput.pkceVerifier).toBe('verifier-abc');
  });

  test('rejects with OAuth2TimeoutError when no redirect arrives and frees the listener', async function () {
    const auth = makeStubAuth();
    const openBrowser = async function () {
      // never drives a redirect
    };
    let caught: unknown;
    try {
      await runLoopbackFlow(auth, ctx, { openBrowser, timeoutMs: 20 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OAuth2TimeoutError);
  });

  test('rejects with OAuth2DeniedError when the provider redirects with an error; exchange not called', async function () {
    const auth = makeStubAuth();
    const openBrowser = driveBrowser(function ({ state }) {
      return `error=access_denied&state=${state}`;
    });
    let caught: unknown;
    try {
      await runLoopbackFlow(auth, ctx, { openBrowser, timeoutMs: 5_000 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OAuth2DeniedError);
    expect(auth.exchangeCalls).toHaveLength(0);
  });

  test('rejects with OAuth2StateMismatchError when the echoed state differs; exchange not called', async function () {
    const auth = makeStubAuth();
    const openBrowser = driveBrowser(function () {
      return 'code=c&state=tampered';
    });
    let caught: unknown;
    try {
      await runLoopbackFlow(auth, ctx, { openBrowser, timeoutMs: 5_000 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OAuth2StateMismatchError);
    expect(auth.exchangeCalls).toHaveLength(0);
  });

  test('rejects with OAuth2Error when the redirect carries no code; exchange not called', async function () {
    const auth = makeStubAuth();
    const openBrowser = driveBrowser(function ({ state }) {
      return `state=${state}`;
    });
    let caught: unknown;
    try {
      await runLoopbackFlow(auth, ctx, { openBrowser, timeoutMs: 5_000 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OAuth2Error);
    expect((caught as OAuth2Error).message).toContain('no authorization code');
    expect(auth.exchangeCalls).toHaveLength(0);
  });

  test('rejects with OAuth2Error when openBrowser throws', async function () {
    const auth = makeStubAuth();
    const openBrowser = async function () {
      throw new Error('no browser');
    };
    let caught: unknown;
    try {
      await runLoopbackFlow(auth, ctx, { openBrowser, timeoutMs: 5_000 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OAuth2Error);
    expect((caught as OAuth2Error).message).toContain('failed to open browser');
  });

  test('propagates when auth.authorize rejects and settles (no hang)', async function () {
    const auth = makeStubAuth({
      authorize: async function () {
        throw new Error('authorize boom');
      },
    });
    const openBrowser = async function () {
      // authorize failed first; should never be called
    };
    let caught: unknown;
    try {
      await runLoopbackFlow(auth, ctx, { openBrowser, timeoutMs: 5_000 });
    } catch (e) {
      caught = e;
    }
    expect((caught as Error).message).toContain('authorize boom');
  });

  test('propagates when auth.exchange rejects and frees the listener', async function () {
    const auth = makeStubAuth({
      exchange: async function () {
        throw new Error('exchange boom');
      },
    });
    const openBrowser = driveBrowser(function ({ state }) {
      return `code=server-code&state=${state}`;
    });
    let caught: unknown;
    try {
      await runLoopbackFlow(auth, ctx, { openBrowser, timeoutMs: 5_000 });
    } catch (e) {
      caught = e;
    }
    expect((caught as Error).message).toContain('exchange boom');
  });
});
