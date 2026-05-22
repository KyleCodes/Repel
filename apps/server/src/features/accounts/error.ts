import { AppError } from '../../lib/error.ts';

// Feature-level base for the accounts service. Concrete error types in this
// feature extend AccountsServiceError so the facade layer can match either
// the specific type (UserAlreadyExistsError) or the feature as a whole
// (AccountsServiceError) when mapping to a response.

export abstract class AccountsServiceError extends AppError {}

export class UserAlreadyExistsError extends AccountsServiceError {
  constructor(message: string) {
    super(message);
  }
}

export class ProviderAccountNotFoundError extends AccountsServiceError {
  constructor(message: string) {
    super(message);
  }
}
