import { AppError } from '@repel/errors';

// Errors raised by the sync CLI namespace. Extend AppError so the facade error
// boundary can distinguish a known, surfaceable failure from an unexpected crash.
export abstract class SyncCliError extends AppError {}

// Raised when `sync run` resolves an account whose credentials column is null —
// there is nothing to decrypt and no way to authenticate the sync. Thrown before
// any ingest call or stdout write.
export class AccountCredentialsMissingError extends SyncCliError {}
