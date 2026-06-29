import { DateTime } from 'luxon';
import { boundedConcurrencyPoolStream } from '@repel/concurrency';
import type { Iso8601String } from '@repel/datetime/types';
import { type HttpDeps } from '@repel/http/client';
import { logger } from '@repel/logger/logger';
import { refreshIfExpired } from '../../lib/oauth2/flow';
import type {
  AdapterEvent,
  AdapterMessageEvent,
  AttachmentContent,
  GmailIngestInput,
  NormalizedAttachment,
} from '../../types';
import {
  GmailAttachmentFetchError,
  GmailIngestError,
  GmailMessageFetchError,
  GmailNormalizeError,
} from '../error';
import { buildGmailRawMessage, normalizeGmailMessage } from '../normalize';
import { loadGmailOAuthConfig, withRedirectUri } from '../oauth';
import { getGmailAttachment } from '../queries/attachments';
import { getGmailMessage, listGmailMessages } from '../queries/messages';
import { buildRangeQuery, gmailAfter } from './query-date';

// The resumption cursor emitted on `completed`: the newest message's send time
// (Gmail `internalDate`) seen this run, in ISO-8601. The next `incremental` sync
// feeds it straight back as its `cursor` to bound an `after:` query. All three
// sync modes emit this same shape so any run's cursor can seed an incremental
// one. The runner persists it (REP-21); the adapter only accepts/returns it.
export interface GmailSyncCursor {
  readonly lastInternalDate: Iso8601String;
}

// Default cap when a full sync omits `limit`. v0 is a capped sync; an uncapped
// full backfill is out of scope until the runner (REP-21) drives it.
const DEFAULT_FULL_SYNC_CAP = 100;

// Gmail's per-page list size.
const PAGE_SIZE = 100;

// How many messages.get calls run concurrently. Gmail's per-user ceiling is 250
// quota units/sec and messages.get is ~5 units (~50 gets/sec), so ~8 in flight at
// ~150ms latency lands near that with headroom. The per-method cost reportedly
// rose toward 20 units in 2026 (~12 gets/sec) — if so, tune this down to ~4.
// Overridable via deps.fetchConcurrency.
const DEFAULT_FETCH_CONCURRENCY = 8;

// Deps for ingest: the HTTP seam plus an optional cap on concurrent message
// fetches (defaults to DEFAULT_FETCH_CONCURRENCY).
export type IngestDeps = HttpDeps & { fetchConcurrency?: number };

// Run a sync as a stream of events:
//   started -> auth -> message* -> completed
// Handles all three spec modes:
//   - full:        page the whole mailbox, capped (dev/debug) at spec.limit.
//   - range:       an `after:`/`before:` window from spec.from / spec.to.
//   - incremental: an `after:` from the prior run's cursor (since-last-sync).
// Fail-loud: any message-get / normalize / attachment-fetch failure aborts the
// sync with a typed error rather than skipping the message. Messages are fetched
// concurrently (up to fetchConcurrency) and emitted in completion order.
export async function* ingest(
  input: GmailIngestInput,
  deps: IngestDeps = {}
): AsyncGenerator<AdapterEvent> {
  // Resolve the list query and (for incremental) the cursor to fall back to when
  // nothing new arrives — both derived purely from the spec, before any I/O.
  const plan = planList(input);

  yield { type: 'started' };

  // Refresh the access token only if it is expired/near-expiry; the policy and
  // its error vocabulary live in oauth2/. credentials is the bare stored
  // TokenSet — the platform hands it in unread. On a refresh, carry the rotated
  // set (same bare shape that gets stored) so the runner can persist it.
  const config = withRedirectUri(loadGmailOAuthConfig(), '');
  const { tokens, refreshed } = await refreshIfExpired(
    { config, tokens: input.credentials },
    deps
  );
  const accessToken = tokens.accessToken;
  yield {
    type: 'auth',
    refreshed,
    ...(refreshed && { credentials: tokens }),
  };

  // Fetch messages concurrently and emit each as it completes. The id source
  // paginates lazily, so only as many pages are listed as the pool drains.
  // Track the newest internalDate seen across the (out-of-order) completions —
  // the resumption cursor is the max, not the last emitted.
  const concurrency = deps.fetchConcurrency ?? DEFAULT_FETCH_CONCURRENCY;
  let processed = 0;
  let newest: number | undefined;
  for await (const event of boundedConcurrencyPoolStream(
    messageIds(accessToken, { q: plan.q, cap: plan.cap }, deps),
    concurrency,
    (id) => processMessage(id, input, accessToken, deps)
  )) {
    yield event;
    processed += 1;
    const ms = internalDateMs(event);
    if (ms !== undefined && (newest === undefined || ms > newest)) newest = ms;
  }

  yield {
    type: 'completed',
    cursor: nextCursor(newest, plan.fallback),
    processed,
  };
}

// What to list and how to resume, resolved from the spec alone (no I/O):
//   - q:        the Gmail search query, or undefined to list the whole mailbox.
//   - cap:      max messages to fetch, or undefined for the full window.
//   - fallback: the cursor to emit when no messages are seen (incremental echoes
//               the inbound cursor so it doesn't rewind; others emit nothing).
interface ListPlan {
  readonly q?: string;
  readonly cap?: number;
  readonly fallback?: GmailSyncCursor;
}

function planList(input: GmailIngestInput): ListPlan {
  const spec = input.spec;
  switch (spec.type) {
    case 'full':
      return { cap: spec.limit ?? DEFAULT_FULL_SYNC_CAP };
    case 'range': {
      const after =
        spec.from !== undefined ? DateTime.fromISO(spec.from) : undefined;
      const before =
        spec.to !== undefined ? DateTime.fromISO(spec.to) : undefined;
      return { q: buildRangeQuery({ after, before }) };
    }
    case 'incremental': {
      const cursor = parseCursor(spec.cursor);
      const after = DateTime.fromISO(cursor.lastInternalDate);
      return { q: gmailAfter(after), fallback: cursor };
    }
  }
}

// Narrow the opaque inbound cursor (the platform stores/returns it unread) to
// the shape this adapter emitted. A malformed cursor is a fail-loud error so the
// caller can fall back to a full sync rather than silently rewinding.
function parseCursor(cursor: unknown): GmailSyncCursor {
  if (
    typeof cursor === 'object' &&
    cursor !== null &&
    'lastInternalDate' in cursor &&
    typeof (cursor as { lastInternalDate: unknown }).lastInternalDate ===
      'string'
  ) {
    return { lastInternalDate: (cursor as GmailSyncCursor).lastInternalDate };
  }
  throw new GmailIngestError(
    'incremental sync cursor is malformed; expected { lastInternalDate: string }'
  );
}

// The resumption cursor: the newest message seen (ISO) when any were, else the
// fallback (incremental echoes its inbound cursor; full/range with an empty
// result have no fallback and emit undefined).
function nextCursor(
  newestMs: number | undefined,
  fallback: GmailSyncCursor | undefined
): GmailSyncCursor | undefined {
  if (newestMs === undefined) return fallback;
  return {
    lastInternalDate: DateTime.fromMillis(newestMs, { zone: 'utc' }).toISO()!,
  };
}

// Pull Gmail's internalDate (epoch-ms string) off a message event as a number,
// for the running max. Non-message events and absent dates yield undefined.
function internalDateMs(event: AdapterEvent): number | undefined {
  if (event.type !== 'message') return undefined;
  const raw = (event as AdapterMessageEvent).raw.payload as {
    internalDate?: string;
  };
  if (raw.internalDate === undefined) return undefined;
  const ms = Number(raw.internalDate);
  return Number.isNaN(ms) ? undefined : ms;
}

// Page through the message list lazily, yielding ids until the cap is hit (when
// set) or pages run out. With no cap the whole result set is walked. `q` filters
// the list (date window); undefined lists everything. The consumer pulls only as
// fast as the fetch pool drains, so pages are listed on demand.
async function* messageIds(
  accessToken: string,
  opts: { q?: string; cap?: number },
  deps: HttpDeps
): AsyncGenerator<string> {
  const { q, cap } = opts;
  let pageToken: string | undefined;
  let n = 0;
  while (cap === undefined || n < cap) {
    const maxResults =
      cap === undefined ? PAGE_SIZE : Math.min(PAGE_SIZE, cap - n);
    const page = await listGmailMessages(
      { accessToken, pageToken, maxResults, ...(q !== undefined && { q }) },
      deps
    );
    for (const ref of page.messages ?? []) {
      if (cap !== undefined && n >= cap) return;
      n += 1;
      yield ref.id;
    }
    if (page.nextPageToken === undefined) return;
    pageToken = page.nextPageToken;
  }
}

// Fetch one message, normalize it, and fetch its attachment bytes. Each step
// fails loud with a typed error.
async function processMessage(
  id: string,
  input: GmailIngestInput,
  accessToken: string,
  deps: HttpDeps
): Promise<AdapterEvent> {
  let message;
  try {
    message = await getGmailMessage({ accessToken, id }, deps);
  } catch (cause) {
    throw new GmailMessageFetchError(`Gmail messages.get failed for ${id}`, {
      cause,
    });
  }

  const raw = buildGmailRawMessage(message, {
    orgId: input.orgId,
    userId: input.userId,
    providerAccountId: input.providerAccountId,
  });

  let normalized;
  try {
    normalized = normalizeGmailMessage(raw);
  } catch (cause) {
    throw new GmailNormalizeError(`Gmail normalize failed for ${id}`, {
      cause,
    });
  }

  const attachments = await fetchAttachments(
    id,
    accessToken,
    normalized.attachments,
    deps
  );

  return { type: 'message', raw, normalized, attachments };
}

// Fetch the bytes for each attachment that carries a provider id. Attachments
// without an externalAttachmentId (none from Gmail today) are skipped.
async function fetchAttachments(
  messageId: string,
  accessToken: string,
  attachments: readonly NormalizedAttachment[],
  deps: HttpDeps
): Promise<AttachmentContent[]> {
  const out: AttachmentContent[] = [];
  for (const att of attachments) {
    const attachmentId = att.externalAttachmentId;
    if (attachmentId === null || attachmentId === undefined) {
      logger.warn('attachment has no attachmentId; skipping bytes', {
        messageId,
        filename: att.filename,
      });
      continue;
    }
    try {
      const bytes = await getGmailAttachment(
        { accessToken, messageId, attachmentId },
        deps
      );
      out.push({ externalAttachmentId: attachmentId, bytes });
    } catch (cause) {
      throw new GmailAttachmentFetchError(
        `Gmail attachments.get failed for ${messageId}/${attachmentId}`,
        { cause }
      );
    }
  }
  return out;
}
