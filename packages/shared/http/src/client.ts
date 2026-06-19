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

// Plumbing kept out of the request shape: the only dependency is `fetch`,
// injected so tests can supply a stub Response without a network. Defaults to
// the global fetch in production.
export interface HttpDeps {
  readonly fetchImpl?: typeof fetch;
}

// Retry/backoff is a deferred seam: this is the single choke point where it
// would attach. The predicate would retry 429 / 5xx / network errors and never
// 4xx or ZodError; the delay would be full jitter — random(0, min(cap,
// base * 2^attempt)). Not implemented yet to avoid speculative machinery.

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

  let res: Response;
  try {
    res = await doFetch(url, init);
  } catch (cause) {
    throw new HttpNetworkError('HTTP request failed', { cause });
  }

  if (!res.ok) {
    const body = await readErrorBody(res);
    throw new HttpResponseError(`HTTP ${res.status} from ${url}`, {
      status: res.status,
      url,
      body,
    });
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
