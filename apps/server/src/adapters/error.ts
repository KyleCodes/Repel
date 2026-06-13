import { AppError } from '../lib/error.ts';

// Base for every error an adapter raises or carries on a failed event. Concrete
// subclasses (e.g. a re-auth-needed error) are added by the adapters that throw
// them.
export abstract class AdapterError extends AppError {}

// Raised when a provider slug has no registered adapter. The first concrete
// subclass of the abstract base; thrown by the provider registry. This is an
// internal invariant — facade input validation (CLI zod) resolves slugs to the
// known Provider enum before they reach the registry.
export class ProviderNotFoundError extends AdapterError {}

// Raised when a credential refresh fails terminally (refresh token revoked or
// expired). Cross-provider on purpose: the runner switches on it to flag the
// account for re-authorization, distinct from a transient provider/network
// fault it would just retry.
export class AuthExpiredError extends AdapterError {}
