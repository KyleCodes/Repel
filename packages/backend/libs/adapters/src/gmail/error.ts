import { AdapterError } from '../error';

// Base for errors the Gmail adapter raises.
export abstract class GmailAdapterError extends AdapterError {}

// Thrown by adapter members that are declared but not yet implemented — `send`
// at this stage.
export class GmailNotImplementedError extends GmailAdapterError {}

// A `range` sync spec supplied neither `from` nor `to`. An unbounded range is a
// caller bug (it would scan the whole mailbox); a full sync is the right tool.
export class GmailRangeBoundsError extends GmailAdapterError {}

// Base for failures raised while running a sync. v0 fails the whole sync on any
// of these rather than skipping the message — the normalizer is unproven and we
// want parser/fetch faults loud, not silently dropped.
export class GmailIngestError extends GmailAdapterError {}

// A users.messages.get call failed (provider/network fault on the message).
export class GmailMessageFetchError extends GmailIngestError {}

// A users.messages.attachments.get call failed. Bytes are only fetchable while
// the token is live, so a failure here means the message is incompletely
// ingested; v0 fails the sync.
export class GmailAttachmentFetchError extends GmailIngestError {}

// normalize() threw on a fetched message (malformed/unexpected payload).
export class GmailNormalizeError extends GmailIngestError {}
