import { AppError } from '@repel/errors';

// Errors raised by the syncs CLI namespace. Extend AppError so the CLI error
// boundary can distinguish a known, surfaceable failure from an unexpected crash.
export abstract class SyncCliError extends AppError {}

// Raised when `syncs run` is invoked without `--full`. v0 supports only full
// sync; incremental/range land with REP-53.
export class SyncRunFullRequiredError extends SyncCliError {}

// Raised when `syncs run` is given both `--limit` and `--unbounded`. A capped and
// an uncapped full sync are contradictory; the caller must pick one.
export class SyncRunLimitUnboundedError extends SyncCliError {}

// Raised when a read verb is given a job id that no sync job in the org matches.
export class SyncJobNotFoundError extends SyncCliError {}

// Raised when a task id does not belong to the given job (unknown task, or a task
// under a different job than the one in the path).
export class SyncTaskNotFoundError extends SyncCliError {}
