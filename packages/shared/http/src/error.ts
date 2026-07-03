import { AppError } from '@repel/errors';

// Base for failures raised by the typed fetch client. ZodError is deliberately
// NOT wrapped — a schema-parse failure propagates raw so callers can inspect
// the issues directly.
export class HttpError extends AppError {}

// A response was received but the status was non-2xx. Carries the parsed body
// (best-effort) so callers can read provider error codes. `retryAfterMs` is the
// server's `Retry-After` hint in milliseconds when it sent one (used by the
// retry loop, and surfaced on the final error so callers/logs can see it).
export class HttpResponseError extends HttpError {
  readonly status: number;
  readonly url: string;
  readonly body: unknown;
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    info: { status: number; url: string; body: unknown; retryAfterMs?: number }
  ) {
    super(message);
    this.status = info.status;
    this.url = info.url;
    this.body = info.body;
    this.retryAfterMs = info.retryAfterMs;
  }
}

// fetch itself threw (DNS failure, connection refused, …). Wraps the original
// TypeError as the cause, forwarded through the base so `.cause` is the standard
// Error.cause rather than a bespoke field.
export class HttpNetworkError extends HttpError {
  constructor(message: string, info: { cause: unknown }) {
    super(message, { cause: info.cause });
  }
}
