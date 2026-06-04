// The contract every provider adapter implements. An adapter translates between
// an external provider (Gmail, iCloud, …) and the application's normalized
// message shape. Concrete adapters live in adapters/<provider>/; this file is
// only the shared contract.
import type { ChannelSlug, ProviderSlug } from '@repel/shared';
import type {
  Message,
  MessageParticipant,
  MessageRaw,
  Thread,
} from '../infra/db/generated.ts';
import type { AdapterError } from './error.ts';

// What a provider can do, declared once per adapter as a const. Per-account
// variance (e.g. scope-driven send/receive toggles) isn't modeled yet.
export interface Capabilities {
  readonly channel: ChannelSlug;
  readonly canSend: boolean;
  readonly canReceive: boolean;
  readonly ingressMode: 'poll' | 'webhook' | 'both';
}

// What the caller supplies to begin an interactive auth flow for a provider.
// The credentials produced belong to a user within an org; scopes and client
// ids are adapter-internal.
export interface ProviderAuthContext {
  readonly provider: ProviderSlug;
  readonly orgId: string;
  readonly userId: string;
}

// The result of a successful authorization, persisted on a provider_account.
// `credentials` is opaque to the platform (an OAuth token set, an app password,
// an api key); the platform stores it encrypted and hands it back to
// ingest()/send() unread. Those methods refresh it transparently on use; the
// platform never refreshes directly.
export interface ProviderAuthorization {
  readonly externalAccountId: string;
  readonly authMethod: 'oauth2' | 'app_password' | 'api_key';
  readonly credentials: unknown;
}

// Which kind of sync the caller is asking for. Values match the persisted
// sync_kind column. `incremental` resumes from an opaque provider cursor;
// `range` pulls a bounded window; `full` pulls everything.
export type AdapterSyncSpec =
  | { readonly type: 'incremental'; readonly cursor: unknown }
  | { readonly type: 'range'; readonly from?: Date; readonly to?: Date }
  | { readonly type: 'full' };

// Input to a sync. The adapter loads the account's stored credentials itself.
export interface IngestInput {
  readonly orgId: string;
  readonly userId: string;
  readonly providerAccountId: string;
  readonly spec: AdapterSyncSpec;
}

// Input to a single outbound send — one provider API call, no streaming.
export interface SendInput {
  readonly orgId: string;
  readonly userId: string;
  readonly providerAccountId: string;
  readonly to: readonly string[];
  readonly subject?: string;
  readonly bodyText?: string;
  readonly bodyHtml?: string;
  // When replying, the provider message/thread being replied to, so the adapter
  // can set the threading headers.
  readonly inReplyToExternalMessageId?: string;
  readonly externalThreadId?: string;
}

// The provider's payload, with enough fidelity to re-render the message and
// re-normalize it later without re-fetching. The omitted columns are the ones
// the runner assigns when it persists the row.
export type RawMessage = Omit<MessageRaw, 'id' | 'createdAt' | 'syncTaskId'>;

// A participant on a normalized message. `contactId` is omitted because
// resolving it is a DB lookup, and normalize() is pure — a downstream reconciler
// fills it in.
export type NormalizedParticipant = Omit<
  MessageParticipant,
  'id' | 'createdAt' | 'messageId' | 'orgId' | 'userId' | 'contactId'
>;

// The shape normalize() produces. The omitted columns are everything the runner
// owns: db-assigned ids, the raw back-pointer, the resolved thread fk, and the
// read/state flags. externalThreadId comes from the provider (the runner
// resolves it to a thread row), and participants become message_participant rows.
export type NormalizedMessage = Omit<
  Message,
  | 'id'
  | 'createdAt'
  | 'updatedAt'
  | 'orgId'
  | 'userId'
  | 'providerAccountId'
  | 'rawMessageId'
  | 'threadId'
  | 'direction'
  | 'isRead'
  | 'isArchived'
  | 'isStarred'
  | 'isDeleted'
> &
  Pick<Thread, 'externalThreadId'> & {
    readonly participants: readonly NormalizedParticipant[];
  };

// ingest() yields events instead of returning a batch because a sync is
// long-running and unbounded — a backfill can be tens of thousands of messages.
// Streaming lets the runner persist each message in its own short transaction,
// report progress, and checkpoint a cursor mid-sync. A well-formed stream ends
// with exactly one terminal event (`completed` or `failed`).

export interface AdapterStartedEvent {
  readonly type: 'started';
  readonly estimatedTotal?: number;
}

// Marks that the adapter refreshed credentials on use, so the runner can persist
// the rotated token without the credential itself being exposed.
export interface AdapterAuthEvent {
  readonly type: 'auth';
  readonly refreshed: boolean;
}

export interface AdapterProgressEvent {
  readonly type: 'progress';
  readonly processed: number;
  readonly estimatedTotal?: number;
}

// One observed message, carrying both the raw payload and the normalized result.
// `normalized` is null when normalization failed but the raw payload is still
// worth persisting for a later re-normalization attempt.
export interface AdapterMessageEvent {
  readonly type: 'message';
  readonly raw: RawMessage;
  readonly normalized: NormalizedMessage | null;
}

// Terminal success. `cursor` is the resumption token to persist for the next
// incremental sync.
export interface AdapterCompletedEvent {
  readonly type: 'completed';
  readonly cursor: unknown;
  readonly processed: number;
}

// Terminal failure.
export interface AdapterFailedEvent {
  readonly type: 'failed';
  readonly error: AdapterError;
}

export type AdapterEvent =
  | AdapterStartedEvent
  | AdapterAuthEvent
  | AdapterProgressEvent
  | AdapterMessageEvent
  | AdapterCompletedEvent
  | AdapterFailedEvent;

export interface IProviderAdapter {
  readonly capabilities: Capabilities;

  // Interactive flow that produces fresh credentials to persist on a
  // provider_account. The adapter owns the UX (browser loopback for OAuth, a
  // password prompt, a paste-token flow).
  promptUserAuthorization(
    input: ProviderAuthContext
  ): Promise<ProviderAuthorization>;

  // Run a sync as a stream of events. Reads stored credentials and refreshes
  // them transparently; throws only when a refresh fails terminally.
  ingest(input: IngestInput): AsyncIterable<AdapterEvent>;

  send(input: SendInput): Promise<{ providerMessageId: string }>;

  // Pure mapping from a provider payload to the normalized shape. Exposed so a
  // re-normalization flow can re-derive normalized rows from stored raw rows
  // without re-fetching. Does no I/O or DB lookups.
  normalize(raw: RawMessage): NormalizedMessage;
}
