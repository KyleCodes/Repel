import { AppError } from '@repel/errors';

// Errors raised while running a sync job. Extend AppError so an error boundary
// can distinguish a known, surfaceable failure from an unexpected crash.
export abstract class SyncError extends AppError {}

// Raised when an ingest stream ends without a terminal `completed` event (a
// `failed` event throws from inside the loop). A truncated stream must surface
// as a failure rather than a silent exit 0.
export class SyncIncompleteError extends SyncError {}

// Raised when a message event carries `normalized: null`. v0 fails the sync on a
// normalization gap rather than logging and skipping.
export class SyncNormalizationError extends SyncError {}
