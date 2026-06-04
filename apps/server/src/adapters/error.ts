import { AppError } from '../lib/error.ts';

// Base for every error an adapter raises or carries on a failed event. Concrete
// subclasses (e.g. a re-auth-needed error) are added by the adapters that throw
// them.
export abstract class AdapterError extends AppError {}
