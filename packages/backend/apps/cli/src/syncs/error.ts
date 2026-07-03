import { AppError } from '@repel/errors';

// Errors raised by the syncs CLI namespace. Extend AppError so the CLI error
// boundary can distinguish a known, surfaceable failure from an unexpected crash.
export abstract class SyncCliError extends AppError {}

// Raised when `syncs run full` is given both `--limit` and `--unbounded`. A
// capped and an uncapped full sync are contradictory; the caller must pick one.
export class SyncRunLimitUnboundedError extends SyncCliError {}

// Raised when `syncs run range` is given neither `--from` nor `--to`. An
// unbounded range is a full sync — the caller must pick a bound (mirrors the
// adapter's GmailRangeBoundsError).
export class SyncRunRangeBoundsError extends SyncCliError {}

// Raised when `syncs run incremental` has nothing to resume from: no prior
// completed sync for the account and no `--since`/`--cursor` override. Never
// silently falls back to a full sync — the caller must run `full` first or pass
// an explicit start.
export class SyncRunNoCursorError extends SyncCliError {}

// Raised when a read verb is given a job id that no sync job in the org matches.
export class SyncJobNotFoundError extends SyncCliError {}

// Raised when a task id does not belong to the given job (unknown task, or a task
// under a different job than the one in the path).
export class SyncTaskNotFoundError extends SyncCliError {}
