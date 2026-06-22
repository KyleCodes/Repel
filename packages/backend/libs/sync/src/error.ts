import { AppError } from '@repel/errors';

export abstract class SyncError extends AppError {}

// Account had no stored credentials, decryption failed, or the adapter threw.
export class SyncTaskFailedError extends SyncError {}

// The ingest stream ended without a terminal completed/failed event.
export class SyncIncompleteStreamError extends SyncError {}

// A message event arrived with no normalized payload (a v0 contract violation).
export class SyncMissingNormalizedError extends SyncError {}
