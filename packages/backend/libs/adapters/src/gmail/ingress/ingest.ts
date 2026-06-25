import { boundedConcurrencyPoolStream } from '@repel/concurrency';
import { type HttpDeps } from '@repel/http/client';
import { logger } from '@repel/logger/logger';
import { refreshIfExpired } from '../../lib/oauth2/flow';
import type {
  AdapterEvent,
  AttachmentContent,
  GmailIngestInput,
  NormalizedAttachment,
} from '../../types';
import {
  GmailAttachmentFetchError,
  GmailIngestError,
  GmailMessageFetchError,
  GmailNormalizeError,
  GmailNotImplementedError,
} from '../error';
import { buildGmailRawMessage, normalizeGmailMessage } from '../normalize';
import { loadGmailOAuthConfig, withRedirectUri } from '../oauth';
import { getGmailAttachment } from '../queries/attachments';
import { getGmailMessage, listGmailMessages } from '../queries/messages';
import { getGmailProfile } from '../queries/profile';

// The resumption cursor emitted on `completed`: Gmail's historyId, the seed for
// the next incremental sync (REP-53). The runner persists it to
// provider_account.sync_cursor; v0 only emits it.
export interface GmailSyncCursor {
  readonly historyId: string;
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

// Run a v0 capped full sync as a stream of events:
//   started -> auth -> message* -> completed
// Only spec.type === 'full' is handled; incremental/range throw. Fail-loud: any
// message-get / normalize / attachment-fetch failure aborts the sync with a typed
// error rather than skipping the message. Messages are fetched concurrently (up
// to fetchConcurrency) and emitted in completion order.
export async function* ingest(
  input: GmailIngestInput,
  deps: IngestDeps = {}
): AsyncGenerator<AdapterEvent> {
  if (input.spec.type !== 'full') {
    throw new GmailNotImplementedError(
      `Gmail ingest v0 supports only full sync; got '${input.spec.type}'`
    );
  }
  const cap = input.spec.limit ?? DEFAULT_FULL_SYNC_CAP;

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

  // Capture the cursor BEFORE listing so the next incremental sync replays
  // anything that arrives during this backfill (no gap).
  const cursor = await loadCursor(accessToken, deps);

  // Fetch messages concurrently and emit each as it completes. The id source
  // paginates lazily and stops at the cap, so at most `cap` messages are fetched.
  const concurrency = deps.fetchConcurrency ?? DEFAULT_FETCH_CONCURRENCY;
  let processed = 0;
  for await (const event of boundedConcurrencyPoolStream(
    messageIds(accessToken, cap, deps),
    concurrency,
    (id) => processMessage(id, input, accessToken, deps)
  )) {
    yield event;
    processed += 1;
  }

  yield { type: 'completed', cursor, processed };
}

// Page through the message list lazily, yielding ids up to the cap and no
// further. Stops following pages once the cap is hit (the consumer pulls only as
// fast as the fetch pool drains, so pages are listed on demand).
async function* messageIds(
  accessToken: string,
  cap: number,
  deps: HttpDeps
): AsyncGenerator<string> {
  let pageToken: string | undefined;
  let n = 0;
  while (n < cap) {
    const page = await listGmailMessages(
      { accessToken, pageToken, maxResults: Math.min(PAGE_SIZE, cap - n) },
      deps
    );
    for (const ref of page.messages ?? []) {
      if (n >= cap) return;
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

// Read the current historyId for the resumption cursor.
async function loadCursor(
  accessToken: string,
  deps: HttpDeps
): Promise<GmailSyncCursor> {
  let profile;
  try {
    profile = await getGmailProfile({ accessToken }, deps);
  } catch (cause) {
    throw new GmailIngestError('Gmail users.getProfile failed (cursor)', {
      cause,
    });
  }
  return { historyId: profile.historyId ?? '' };
}
