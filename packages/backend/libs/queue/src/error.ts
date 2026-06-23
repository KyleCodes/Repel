import { AppError } from '@repel/errors';

export abstract class QueueError extends AppError {}

// A handler throws this to dead-letter the envelope immediately, skipping the
// remaining retry attempts. Any other throw is treated as transient.
export class PermanentHandlerError extends QueueError {}
