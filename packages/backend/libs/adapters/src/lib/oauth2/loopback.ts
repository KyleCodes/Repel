import { spawn } from 'node:child_process';
import {
  type IncomingMessage,
  type ServerResponse,
  createServer,
} from 'node:http';
import { platform } from 'node:os';
import type { HttpDeps } from '@repel/http/client';
import type {
  ProviderAuth,
  ProviderAuthContext,
  ProviderAuthorization,
} from '../../types';
import {
  OAuth2DeniedError,
  OAuth2Error,
  OAuth2StateMismatchError,
  OAuth2TimeoutError,
} from './error';

export const LOOPBACK_TIMEOUT_MS = 120_000;

export type RedirectResult =
  | { readonly ok: true; readonly code: string }
  | {
      readonly ok: false;
      readonly reason: 'missing_code' | 'state_mismatch' | 'oauth_error';
      readonly detail?: string;
    };

// Pure parse of a loopback redirect URL. State is checked first (a CSRF signal),
// then a provider error, then the presence of the code. The base is a fixed
// loopback host because the incoming request carries only the path + query.
export function handleRedirect(args: {
  url: string;
  expectedState: string;
}): RedirectResult {
  const { url, expectedState } = args;
  const params = new URL(url, 'http://127.0.0.1').searchParams;

  if (params.get('state') !== expectedState) {
    return { ok: false, reason: 'state_mismatch' };
  }

  const error = params.get('error');
  if (error) {
    return { ok: false, reason: 'oauth_error', detail: error };
  }

  const code = params.get('code');
  if (!code) {
    return { ok: false, reason: 'missing_code' };
  }

  return { ok: true, code };
}

// Open a URL in the user's default browser. Detached + unref'd so the consent
// page outlives this process's interest in it.
export function realOpenBrowser(url: string): void {
  const command =
    platform() === 'darwin'
      ? 'open'
      : platform() === 'win32'
        ? 'start'
        : 'xdg-open';
  const child = spawn(command, [url], { detached: true, stdio: 'ignore' });
  child.unref();
}

const SUCCESS_HTML =
  '<!doctype html><meta charset="utf-8"><title>Authorized</title><p>Authorization complete. You can return to your terminal.</p>';
const FAILURE_HTML =
  '<!doctype html><meta charset="utf-8"><title>Authorization failed</title><p>Authorization failed. Return to your terminal for details.</p>';

// A bound loopback listener awaiting a single OAuth redirect. `redirectUri` is
// derived from the ephemeral port and is the URI handed to both authorize and
// exchange. `setExpectedState` arms the state check before the browser opens (a
// redirect can only arrive after that). `awaitRedirect` resolves with the parsed
// result of the first request and never again. `close` is idempotent.
interface LoopbackListener {
  readonly redirectUri: string;
  setExpectedState(state: string): void;
  readonly awaitRedirect: Promise<RedirectResult>;
  close(): void;
}

// Bind an ephemeral loopback server and resolve once it is listening. The
// request handler parses the first redirect, replies with a terminal HTML page,
// and settles awaitRedirect. Rejects if the port cannot be bound.
function bindLoopbackListener(): Promise<LoopbackListener> {
  return new Promise(function (resolve, reject) {
    const server = createServer();
    let closed = false;
    let expectedState = '';

    function close(): void {
      if (closed) return;
      closed = true;
      server.close();
    }

    let onRedirect: (result: RedirectResult) => void;
    const awaitRedirect = new Promise<RedirectResult>(function (res) {
      onRedirect = res;
    });

    server.on('request', function (req: IncomingMessage, res: ServerResponse) {
      const result = handleRedirect({
        url: req.url ?? '/',
        expectedState,
      });
      res.writeHead(result.ok ? 200 : 400, { 'content-type': 'text/html' });
      res.end(result.ok ? SUCCESS_HTML : FAILURE_HTML);
      onRedirect(result);
    });

    server.on('error', function (err: Error) {
      close();
      reject(new OAuth2Error(`loopback server failed: ${err.message}`));
    });

    server.listen(0, '127.0.0.1', function () {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        close();
        reject(new OAuth2Error('failed to bind loopback port'));
        return;
      }
      resolve({
        redirectUri: `http://127.0.0.1:${address.port}/`,
        setExpectedState(state: string): void {
          expectedState = state;
        },
        awaitRedirect,
        close,
      });
    });
  });
}

// Race a promise against a timeout, clearing the timer on settle either way.
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout: () => Error
): Promise<T> {
  return new Promise<T>(function (resolve, reject) {
    const timer = setTimeout(function () {
      reject(onTimeout());
    }, ms);
    promise.then(
      function (value) {
        clearTimeout(timer);
        resolve(value);
      },
      function (err: unknown) {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

// Open the browser, mapping any failure to an OAuth2Error. Accepts sync or async
// openers (the real one is sync; tests inject async).
async function openBrowserOrThrow(
  openBrowser: (url: string) => void | Promise<void>,
  url: string
): Promise<void> {
  try {
    await openBrowser(url);
  } catch (err: unknown) {
    throw new OAuth2Error(
      `failed to open browser: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

// Map a failed redirect parse to the corresponding OAuth2 error.
function redirectError(
  result: Extract<RedirectResult, { ok: false }>
): OAuth2Error {
  if (result.reason === 'state_mismatch') {
    return new OAuth2StateMismatchError('state nonce did not match');
  }
  if (result.reason === 'oauth_error') {
    return new OAuth2DeniedError(
      `provider returned error: ${result.detail ?? 'unknown'}`
    );
  }
  return new OAuth2Error('redirect carried no authorization code');
}

// Drive an interactive OAuth2 authorization-code flow over a loopback listener,
// generic over any oauth2 adapter. Bind an ephemeral port, ask the adapter to
// build the consent URL (authorize), open the browser, await the single redirect
// under a timeout, validate it, then hand the code back to the adapter (exchange)
// for its ProviderAuthorization. The redirectUri is derived once and threaded
// into both authorize and exchange so the token exchange byte-matches the consent
// URL. The listener is always closed (finally), on every path.
export async function runLoopbackFlow(
  auth: Extract<ProviderAuth, { method: 'oauth2' }>,
  ctx: ProviderAuthContext,
  deps?: {
    openBrowser?: (url: string) => void | Promise<void>;
    timeoutMs?: number;
    http?: HttpDeps;
  }
): Promise<ProviderAuthorization> {
  const openBrowser = deps?.openBrowser ?? realOpenBrowser;
  const timeoutMs = deps?.timeoutMs ?? LOOPBACK_TIMEOUT_MS;

  const listener = await bindLoopbackListener();
  try {
    const { authUrl, state, pkceVerifier } = await auth.authorize({
      ...ctx,
      redirectUri: listener.redirectUri,
    });
    // Arm the state check before the browser opens — a redirect can only arrive
    // after this point.
    listener.setExpectedState(state);

    await openBrowserOrThrow(openBrowser, authUrl);

    const result = await withTimeout(
      listener.awaitRedirect,
      timeoutMs,
      () => new OAuth2TimeoutError('timed out waiting for authorization')
    );
    if (!result.ok) {
      throw redirectError(result);
    }

    return await auth.exchange(
      {
        code: result.code,
        state,
        expectedState: state,
        pkceVerifier,
        redirectUri: listener.redirectUri,
      },
      deps?.http
    );
  } finally {
    listener.close();
  }
}
