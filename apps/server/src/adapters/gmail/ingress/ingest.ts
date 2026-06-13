import { type HttpDeps } from '../../../lib/http/client.ts';
import { refreshIfExpired } from '../../lib/oauth2/flow.ts';
import type {
  AdapterEvent,
  AttachmentContent,
  GmailIngestInput,
  NormalizedAttachment,
} from '../../types.ts';
import {
  GmailAttachmentFetchError,
  GmailIngestError,
  GmailMessageFetchError,
  GmailNormalizeError,
  GmailNotImplementedError,
} from '../error.ts';
import { buildGmailRawMessage, normalizeGmailMessage } from '../normalize.ts';
import { loadGmailOAuthConfig, withRedirectUri } from '../oauth.ts';
import { getGmailAttachment } from '../queries/attachments.ts';
import { getGmailMessage, listGmailMessages } from '../queries/messages.ts';
import { getGmailProfile } from '../queries/profile.ts';

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

// Run a v0 capped full sync as a stream of events:
//   started -> auth -> message* -> completed
// Only spec.type === 'full' is handled; incremental/range throw. Fail-loud: any
// message-get / normalize / attachment-fetch failure aborts the sync with a typed
// error rather than skipping the message.
export async function* ingest(
  input: GmailIngestInput,
  deps: HttpDeps = {}
): AsyncGenerator<AdapterEvent> {
  if (input.spec.type !== 'full') {
    throw new GmailNotImplementedError(
      `Gmail ingest v0 supports only full sync; got '${input.spec.type}'`
    );
  }
  const cap = input.spec.limit ?? DEFAULT_FULL_SYNC_CAP;

  yield { type: 'started' };

  // Refresh the access token only if it is expired/near-expiry; the policy and
  // its error vocabulary live in oauth2/. On a refresh, carry the rotated
  // credential so the runner can persist it.
  const config = withRedirectUri(loadGmailOAuthConfig(), '');
  const { tokens, refreshed } = await refreshIfExpired(
    { config, tokens: input.credentials.tokens },
    deps
  );
  const accessToken = tokens.accessToken;
  yield {
    type: 'auth',
    refreshed,
    ...(refreshed && { credentials: { provider: 'gmail', tokens } }),
  };

  // Capture the cursor BEFORE listing so the next incremental sync replays
  // anything that arrives during this backfill (no gap).
  const cursor = await loadCursor(accessToken, deps);

  // Paginate, capped. Stop following pages once the cap is reached.
  let processed = 0;
  let pageToken: string | undefined;
  do {
    const remaining = cap - processed;
    if (remaining <= 0) break;
    const page = await listGmailMessages(
      { accessToken, pageToken, maxResults: Math.min(PAGE_SIZE, remaining) },
      deps
    );
    for (const messageRef of page.messages ?? []) {
      if (processed >= cap) break;
      yield await processMessage(messageRef.id, input, accessToken, deps);
      processed += 1;
    }
    pageToken = page.nextPageToken;
  } while (pageToken !== undefined && processed < cap);

  yield { type: 'completed', cursor, processed };
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
      console.warn(
        `Gmail attachment on message ${messageId} has no attachmentId; skipping bytes (filename: ${att.filename})`
      );
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
