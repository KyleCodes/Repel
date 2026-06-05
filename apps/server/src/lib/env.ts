import { AppError } from './error.ts';

// Thrown when a required environment variable is missing or empty. Extends
// AppError so the facade layer can catch it at its error boundary like any
// other domain error. An optional message overrides the default for callers that
// want to point at a remediation (e.g. "pass --user or set REPEL_USER_ID").
export class MissingEnvVarError extends AppError {
  constructor(name: string, message?: string) {
    super(message ?? `${name} is not set`);
  }
}

// Read a required environment variable. An unset or empty value throws
// MissingEnvVarError — the single choke point for "this must be configured".
// Pass `message` to override the default error text with caller-specific
// remediation.
export function getRequiredEnvVar(name: string, message?: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new MissingEnvVarError(name, message);
  }
  return value;
}

// Read an optional environment variable, returning the fallback (default
// undefined) when it is unset or empty. An empty string is treated as absent.
export function getOptionalEnvVar(name: string): string | undefined;
export function getOptionalEnvVar(name: string, fallback: string): string;
export function getOptionalEnvVar(
  name: string,
  fallback?: string
): string | undefined {
  const value = process.env[name];
  if (value === undefined || value === '') {
    return fallback;
  }
  return value;
}
