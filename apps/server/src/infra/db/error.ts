import { AppError } from '../../lib/error.ts';

// Base for errors that originate at the database boundary. `code` is the pg
// SQLSTATE when the error came from Postgres (undefined for non-pg faults
// wrapped here). These classes give a raw pg/Kysely error a typed, AppError-
// rooted form the application layer can match on with instanceof.
export class DBError extends AppError {
  constructor(
    message: string,
    readonly code: string | undefined = undefined
  ) {
    super(message);
  }
}

// A Postgres unique-constraint violation (SQLSTATE 23505). `constraint` is the
// violated constraint name when pg reported one, so a caller can distinguish one
// specific unique index from any other unique violation on the same table.
export class DBUniqueViolationError extends DBError {
  constructor(
    message: string,
    readonly constraint: string | undefined,
    code: string | undefined = undefined
  ) {
    super(message, code);
  }
}

const UNIQUE_VIOLATION = '23505';

// Normalize any thrown value into the AppError hierarchy, classifying pg errors
// into the DBError family. Every return is an AppError: an existing AppError is
// passed through unchanged (preserves a domain error a view/mutation threw
// inside the tx — e.g. ProviderAccountNotFoundError); a pg error is mapped by
// SQLSTATE (23505 → DBUniqueViolationError, else a plain DBError carrying the
// code); anything else is wrapped in a generic DBError. Lets a service match on
// typed errors without string-matching pg internals at the callsite.
export function normalizeDbError(err: unknown): AppError {
  if (err instanceof AppError) {
    return err;
  }

  if (typeof err === 'object' && err !== null) {
    const candidate = err as {
      code?: unknown;
      constraint?: unknown;
      message?: unknown;
    };
    if (typeof candidate.code === 'string') {
      const message =
        typeof candidate.message === 'string'
          ? candidate.message
          : `database error ${candidate.code}`;
      if (candidate.code === UNIQUE_VIOLATION) {
        const constraint =
          typeof candidate.constraint === 'string'
            ? candidate.constraint
            : undefined;
        return new DBUniqueViolationError(message, constraint, candidate.code);
      }
      return new DBError(message, candidate.code);
    }
  }

  return new DBError(err instanceof Error ? err.message : String(err));
}
