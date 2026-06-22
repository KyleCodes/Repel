import { AppError } from '@repel/errors';

// Errors raised by the sync executor. Extend AppError so a facade error boundary
// can tell a known sync failure from an unexpected crash.
export abstract class SyncError extends AppError {}

// A task could not be set up or its stream failed: the account had no stored
// credentials, decryption failed, or the adapter threw. Caught by the executor
// and reported on the task result — never propagated to sibling tasks.
export class SyncTaskFailedError extends SyncError {}

// The adapter's ingest stream ended without a terminal `completed` or `failed`
// event. A well-formed stream ends with exactly one terminal event, so this is a
// malformed stream; the executor treats it as a task failure.
export class SyncIncompleteStreamError extends SyncError {}
