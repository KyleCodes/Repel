import { spawn } from 'node:child_process';
import {
  type IncomingMessage,
  type ServerResponse,
  createServer,
} from 'node:http';
import { platform } from 'node:os';
import {
  OAuth2DeniedError,
  OAuth2Error,
  OAuth2StateMismatchError,
  OAuth2TimeoutError,
} from './error.ts';
import { buildAuthUrl } from './flow.ts';
import { generatePkce, generateState } from './pkce.ts';
import type { OAuth2Config } from './types.ts';

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

// The impure half: bind an ephemeral loopback listener, open the browser, await
// the redirect, validate state, and resolve with the code + verifier +
// redirectUri. The redirectUri is derived once from the bound port and threaded
// out so the caller's token exchange byte-matches the auth URL. Always closes
// the server and clears the timer.
export function runLoopbackFlow(args: {
  config: Omit<OAuth2Config, 'redirectUri'>;
  pkce?: { verifier: string; challenge: string };
  state?: string;
  openBrowser?: (url: string) => void | Promise<void>;
  timeoutMs?: number;
}): Promise<{ code: string; verifier: string; redirectUri: string }> {
  const {
    config,
    pkce = generatePkce(),
    state = generateState(),
    openBrowser = realOpenBrowser,
    timeoutMs = LOOPBACK_TIMEOUT_MS,
  } = args;

  return new Promise(function (resolve, reject) {
    const server = createServer();
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;

    function finish(fn: () => void): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      fn();
    }

    server.on('request', function (req: IncomingMessage, res: ServerResponse) {
      const result = handleRedirect({
        url: req.url ?? '/',
        expectedState: state,
      });
      res.writeHead(result.ok ? 200 : 400, { 'content-type': 'text/html' });
      res.end(result.ok ? SUCCESS_HTML : FAILURE_HTML);

      if (result.ok) {
        finish(function () {
          resolve({
            code: result.code,
            verifier: pkce.verifier,
            redirectUri,
          });
        });
        return;
      }
      finish(function () {
        reject(redirectError(result));
      });
    });

    server.on('error', function (err: Error) {
      finish(function () {
        reject(new OAuth2Error(`loopback server failed: ${err.message}`));
      });
    });

    let redirectUri = '';
    server.listen(0, '127.0.0.1', function () {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        finish(function () {
          reject(new OAuth2Error('failed to bind loopback port'));
        });
        return;
      }
      redirectUri = `http://127.0.0.1:${address.port}/`;
      timer = setTimeout(function () {
        finish(function () {
          reject(new OAuth2TimeoutError('timed out waiting for authorization'));
        });
      }, timeoutMs);

      const url = buildAuthUrl({
        config: { ...config, redirectUri },
        state,
        challenge: pkce.challenge,
      });
      void Promise.resolve(openBrowser(url)).catch(function (err: unknown) {
        finish(function () {
          reject(
            new OAuth2Error(
              `failed to open browser: ${err instanceof Error ? err.message : String(err)}`
            )
          );
        });
      });
    });
  });
}

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
