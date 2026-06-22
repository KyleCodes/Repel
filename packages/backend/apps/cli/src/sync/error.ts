import { AppError } from '@repel/errors';

// Errors raised by the sync CLI namespace. Extend AppError so the CLI error
// boundary can distinguish a known, surfaceable failure from an unexpected crash.
export abstract class SyncCliError extends AppError {}

// Raised when `sync run` is invoked without `--full`. v0 supports only full
// sync; incremental/range land with REP-53.
export class SyncRunFullRequiredError extends SyncCliError {}
