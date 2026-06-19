import { AppError } from '@repel/errors';

// Thrown when a required environment variable is missing or empty. Extends
// AppError so the facade layer can catch it at its error boundary like any
// other domain error. An optional message overrides the default for callers that
// want to point at a remediation (e.g. "pass --user or set REPEL_USER_ID").
export class MissingEnvVarError extends AppError {
  constructor(name: string, message?: string) {
    super(message ?? `${name} is not set`);
  }
}
