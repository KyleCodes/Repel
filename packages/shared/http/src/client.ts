import type { ZodType, z } from 'zod';
import { HttpNetworkError, HttpResponseError } from './error';

// A single typed fetch wrapper, the codebase's canonical HTTP entrypoint.
// Structured inputs go in (params, body, headers); a validated value comes out.
// BodyInit / Response are never exposed to callers — the calling code that
// decides WHAT to request stays separate from this module that DOES the request.
export interface HttpRequest<S extends ZodType | undefined = undefined> {
  readonly method?: 'GET' | 'POST';
  readonly url: string;
  readonly params?: Record<string, string>;
  readonly headers?: Record<string, string>;
  readonly body?: Record<string, unknown>;
  readonly encoding?: 'json' | 'form';
  readonly schema?: S;
}

// Context passed to `shouldRetry` to decide whether a failed attempt is worth
// retrying. `status` is the HTTP status (undefined for a network-level throw);
// `body` is the parsed error body (best-effort); `isNetwork` is true when fetch
// itself threw before a response.
export interface RetryContext {
  readonly status?: number;
  readonly body: unknown;
  readonly isNetwork: boolean;
}

// Plumbing kept out of the request shape. `fetchImpl` is injected so tests can
// supply a stub Response without a network. The retry knobs are the single
// choke point for backoff (see the retry loop below); they default to a
// sensible on-by-default policy and can be tuned or disabled (`maxRetries: 0`)
// per caller. `sleep` is injected so tests drive backoff without real timers.
export interface HttpDeps {
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  // Max retry attempts after the initial try. Default DEFAULT_MAX_RETRIES.
  readonly maxRetries?: number;
  // Predicate deciding whether a failed attempt is retryable. Default:
  // 429 / 5xx / network / quota-403 (see defaultShouldRetry).
  readonly shouldRetry?: (ctx: RetryContext) => boolean;
  // Full-jitter backoff curve: delay = random(0, min(cap, base * 2^attempt)).
  readonly retryBaseMs?: number;
  readonly retryCapMs?: number;
  // Total-elapsed safety cap: stop retrying once this is exceeded even if
  // attempts remain, so a hard-stuck endpoint fails rather than spinning.
  readonly maxElapsedMs?: number;
}

// Retry defaults. A high attempt ceiling is cheap because callers pull work
// lazily (e.g. the sync fetch pool), so a backing-off request self-throttles
// rather than compounding load; `maxElapsedMs` bounds the worst case.
const DEFAULT_MAX_RETRIES = 10;
const DEFAULT_RETRY_BASE_MS = 500;
const DEFAULT_RETRY_CAP_MS = 30_000;
const DEFAULT_MAX_ELAPSED_MS = 120_000;

// Default retry predicate: retry transient failures only. 429 (rate limit),
// 5xx (server), a network-level throw, and a quota-flavored 403 (Google returns
// 403 with a rateLimitExceeded/"Quota exceeded" body for per-user quota, which
// IS transient — unlike an auth 403). Never other 4xx; a ZodError from schema
// parse is thrown after the loop and never reaches here.
function defaultShouldRetry(ctx: RetryContext): boolean {
  if (ctx.isNetwork) return true;
  const status = ctx.status;
  if (status === undefined) return false;
  if (status === 429 || status >= 500) return true;
  if (status === 403 && isQuotaBody(ctx.body)) return true;
  return false;
}

// A Google API error body signals per-user quota exhaustion (transient) via a
// reason of rateLimitExceeded/userRateLimitExceeded, or a "Quota exceeded"
// message. Distinguishes it from a permanent auth/permission 403.
function isQuotaBody(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false;
  const err = (body as { error?: unknown }).error;
  if (typeof err !== 'object' || err === null) return false;
  const message = (err as { message?: unknown }).message;
  if (typeof message === 'string' && /quota exceeded/i.test(message)) {
    return true;
  }
  const errors = (err as { errors?: unknown }).errors;
  if (Array.isArray(errors)) {
    for (const e of errors) {
      const reason = (e as { reason?: unknown }).reason;
      if (
        reason === 'rateLimitExceeded' ||
        reason === 'userRateLimitExceeded'
      ) {
        return true;
      }
    }
  }
  return false;
}

// Parse a Retry-After header (RFC 7231): either delta-seconds or an HTTP-date.
// Returns milliseconds, or undefined when absent/unparseable. `nowMs` is passed
// so an HTTP-date is measured against the same clock the caller uses.
function parseRetryAfterMs(
  value: string | null,
  nowMs: number
): number | undefined {
  if (value === null) return undefined;
  const secs = Number(value);
  if (!Number.isNaN(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - nowMs);
  return undefined;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function httpRequest<S extends ZodType>(
  req: HttpRequest<S> & { schema: S },
  deps?: HttpDeps
): Promise<z.infer<S>>;
export function httpRequest<T = unknown>(
  req: HttpRequest<undefined>,
  deps?: HttpDeps
): Promise<T>;
// The implementation signature returns `unknown` because it must satisfy both
// overloads above; callers only ever see the overload return types (`z.infer<S>`
// when a schema is given, otherwise the caller's `T`).
export async function httpRequest<S extends ZodType>(
  req: HttpRequest<S>,
  deps: HttpDeps = {}
): Promise<unknown> {
  const doFetch = deps.fetchImpl ?? fetch;

  const url = buildUrl(req.url, req.params);

  const headers: Record<string, string> = { ...req.headers };
  let body: BodyInit | undefined;
  if (req.body !== undefined) {
    if (req.encoding === 'form') {
      body = new URLSearchParams(toStringRecord(req.body));
      headers['content-type'] = 'application/x-www-form-urlencoded';
    } else {
      body = JSON.stringify(req.body);
      headers['content-type'] = 'application/json';
    }
  }

  const init: RequestInit = { method: req.method ?? 'GET', headers, body };

  const sleep = deps.sleep ?? defaultSleep;
  const maxRetries = deps.maxRetries ?? DEFAULT_MAX_RETRIES;
  const shouldRetry = deps.shouldRetry ?? defaultShouldRetry;
  const base = deps.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
  const cap = deps.retryCapMs ?? DEFAULT_RETRY_CAP_MS;
  const maxElapsedMs = deps.maxElapsedMs ?? DEFAULT_MAX_ELAPSED_MS;
  const startedAt = Date.now();

  // Attempt loop: try, and on a retryable transient failure back off and retry
  // until attempts or the elapsed budget run out. The success-path body parse
  // (res.json + schema.parse) is deliberately OUTSIDE the loop so a ZodError is
  // never retried. `res` from a 2xx breaks out to that parse below.
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    // Perform one attempt, capturing either a Response or a network throw.
    let response: Response | undefined;
    let networkCause: unknown;
    try {
      response = await doFetch(url, init);
    } catch (cause) {
      networkCause = cause;
    }

    const isNetwork = response === undefined;
    const status = response?.status;
    if (response !== undefined && response.ok) {
      res = response;
      break;
    }

    // Non-2xx or network error. Read the body (for the error + retry decision)
    // and the Retry-After hint.
    const errBody = response ? await readErrorBody(response) : undefined;
    const retryAfterMs = response
      ? parseRetryAfterMs(response.headers.get('retry-after'), Date.now())
      : undefined;

    const retryable =
      attempt < maxRetries &&
      Date.now() - startedAt < maxElapsedMs &&
      shouldRetry({ status, body: errBody, isNetwork });

    if (!retryable) {
      if (isNetwork) {
        throw new HttpNetworkError('HTTP request failed', {
          cause: networkCause,
        });
      }
      throw new HttpResponseError(`HTTP ${status} from ${url}`, {
        status: status!,
        url,
        body: errBody,
        retryAfterMs,
      });
    }

    // Honor Retry-After when the server sent one, else full-jitter backoff:
    // random(0, min(cap, base * 2^attempt)).
    const ceiling = Math.min(cap, base * 2 ** attempt);
    const delay = retryAfterMs ?? Math.random() * ceiling;
    await sleep(delay);
  }

  const json: unknown = await res.json();
  return req.schema ? req.schema.parse(json) : json;
}

function buildUrl(base: string, params?: Record<string, string>): string {
  if (!params) return base;
  const u = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    u.searchParams.set(key, value);
  }
  return u.toString();
}

function toStringRecord(body: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    out[key] = String(value);
  }
  return out;
}

async function readErrorBody(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
