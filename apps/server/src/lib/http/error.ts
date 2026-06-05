import { AppError } from '../error.ts';

// Base for failures raised by the typed fetch client. ZodError is deliberately
// NOT wrapped — a schema-parse failure propagates raw so callers can inspect
// the issues directly.
export class HttpError extends AppError {}

// A response was received but the status was non-2xx. Carries the parsed body
// (best-effort) so callers can read provider error codes.
export class HttpResponseError extends HttpError {
  readonly status: number;
  readonly url: string;
  readonly body: unknown;

  constructor(
    message: string,
    info: { status: number; url: string; body: unknown }
  ) {
    super(message);
    this.status = info.status;
    this.url = info.url;
    this.body = info.body;
  }
}

// fetch itself threw (DNS failure, connection refused, …). Wraps the original
// TypeError as the cause.
export class HttpNetworkError extends HttpError {
  readonly cause: unknown;

  constructor(message: string, info: { cause: unknown }) {
    super(message);
    this.cause = info.cause;
  }
}
