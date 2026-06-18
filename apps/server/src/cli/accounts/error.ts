import { AppError } from '../../lib/error.ts';

// Errors raised by the accounts CLI namespace. Extend AppError so the facade
// error boundary can distinguish a known, surfaceable failure from an unexpected
// crash.
export abstract class AccountsCliError extends AppError {}

// Raised when `accounts connect`/`reconnect` is invoked for a provider whose
// adapter uses an auth method the CLI cannot drive interactively (only oauth2
// is supported today).
export class UnsupportedAuthMethodError extends AccountsCliError {}

// Raised when a `reconnect` OAuth flow returns a different externalAccountId
// than the resolved account's — i.e. the operator authorized the wrong login.
// Rotating in this case would silently repoint the row at another mailbox, so
// we reject and write nothing.
export class AccountIdentityMismatchError extends AccountsCliError {}
