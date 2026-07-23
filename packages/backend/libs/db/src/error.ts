import { AppError } from '@repel/errors';
import { Prisma } from './prisma/client';

// Base for errors that originate at the database boundary. `code` is the pg
// SQLSTATE when the error came from Postgres (undefined for non-pg faults
// wrapped here). These classes give a raw pg/Prisma error a typed, AppError-
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
// violated constraint name when it could be recovered, so a caller can
// distinguish one specific unique index from any other unique violation on the
// same table. Prisma declares its error `meta` shape non-public API, so the
// name is extracted best-effort and callers must tolerate undefined.
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

// True when a Prisma query-API write matched no row (P2025) — the replacement
// for Kysely's take-first-or-undefined contract on UPDATE ... RETURNING.
// Mutations catch this locally and return undefined; it never crosses the
// service boundary.
export function isNoResultError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025'
  );
}

// Best-effort scan of a Prisma known-request error's meta for the pg SQLSTATE
// and constraint name. Prisma nests the original driver error at varying
// depths (meta.code, meta.driverAdapterError.cause.*) and none of it is
// public API — every access is optional and the result may be empty.
function extractPgDetails(meta: unknown): {
  sqlstate?: string;
  constraint?: string;
} {
  if (typeof meta !== 'object' || meta === null) return {};
  const m = meta as Record<string, unknown>;

  const out: { sqlstate?: string; constraint?: string } = {};
  if (typeof m.code === 'string') out.sqlstate = m.code;

  const target = m.target;
  if (typeof target === 'string') out.constraint = target;

  const cause = (m.driverAdapterError as Record<string, unknown> | undefined)
    ?.cause as Record<string, unknown> | undefined;
  if (cause) {
    if (out.sqlstate === undefined && typeof cause.code === 'string') {
      out.sqlstate = cause.code;
    }
    const constraint = cause.constraint as Record<string, unknown> | undefined;
    if (typeof constraint?.index === 'string')
      out.constraint = constraint.index;
  }
  return out;
}

// Normalize any thrown value into the AppError hierarchy, classifying database
// errors into the DBError family. Every return is an AppError: an existing
// AppError is passed through unchanged (preserves a domain error a view or
// mutation threw inside the tx); a Prisma known-request error is mapped by its
// code (P2002 → DBUniqueViolationError; raw-query failures carry the pg
// SQLSTATE in meta); a pg-shaped error ({code, constraint}) is mapped by
// SQLSTATE; anything else is wrapped in a generic DBError. The stored `code`
// is always the pg SQLSTATE, never a Prisma P-code, so callers matching on
// SQLSTATE are stable across the driver swap.
export function normalizeDbError(err: unknown): AppError {
  if (err instanceof AppError) {
    return err;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const details = extractPgDetails(err.meta);
    if (err.code === 'P2002' || details.sqlstate === UNIQUE_VIOLATION) {
      return new DBUniqueViolationError(
        err.message,
        details.constraint,
        UNIQUE_VIOLATION
      );
    }
    return new DBError(err.message, details.sqlstate ?? err.code);
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
