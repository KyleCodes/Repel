import { AppError } from '@repel/errors';

// Errors raised by the services CLI namespace. Extend AppError so the facade
// error boundary can distinguish a known, surfaceable failure from a crash.
export abstract class ServicesCliError extends AppError {}

// Raised when `services run <name>` names a service that is not in the registry.
// The message lists the registered names so the operator can correct the verb.
export class UnknownServiceError extends ServicesCliError {}
