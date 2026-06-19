import { MissingEnvVarError } from './error.ts';

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
