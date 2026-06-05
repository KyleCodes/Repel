import { AdapterError } from '../error.ts';

// Base for errors the Gmail adapter raises.
export abstract class GmailAdapterError extends AdapterError {}

// Thrown by adapter members that are declared but not yet implemented (ingest,
// normalize, send in this stage).
export class GmailNotImplementedError extends GmailAdapterError {}
