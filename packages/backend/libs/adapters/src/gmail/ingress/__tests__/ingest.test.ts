import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  OAuth2NoRefreshTokenError,
  OAuth2RefreshError,
} from '../../../lib/oauth2/error';
import type { AdapterEvent, IngestInput } from '../../../types';
import {
  GmailAttachmentFetchError,
  GmailMessageFetchError,
  GmailNotImplementedError,
} from '../../error';
import { ingest } from '../ingest';

let originalId: string | undefined;
let originalSecret: string | undefined;

beforeEach(function () {
  originalId = process.env.REPEL_GMAIL_CLIENT_ID;
  originalSecret = process.env.REPEL_GMAIL_CLIENT_SECRET;
  process.env.REPEL_GMAIL_CLIENT_ID = 'id-123';
  process.env.REPEL_GMAIL_CLIENT_SECRET = 'secret-456';
});

afterEach(function () {
  if (originalId === undefined) delete process.env.REPEL_GMAIL_CLIENT_ID;
  else process.env.REPEL_GMAIL_CLIENT_ID = originalId;
  if (originalSecret === undefined)
    delete process.env.REPEL_GMAIL_CLIENT_SECRET;
  else process.env.REPEL_GMAIL_CLIENT_SECRET = originalSecret;
});

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

function b64url(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64url');
}

const TOKEN_OK = {
  access_token: 'fresh-access',
  expires_in: 3600,
  refresh_token: 'r-new',
  token_type: 'Bearer',
};

function input(overrides?: Partial<IngestInput>): IngestInput {
  return {
    providerSlug: 'gmail',
    orgId: 'org-1',
    userId: 'user-1',
    providerAccountId: 'pa-1',
    spec: { type: 'full', limit: 10 },
    credentials: {
      accessToken: 'stale',
      refreshToken: 'r-1',
      expiresAt: 0,
      tokenType: 'Bearer',
    },
    ...overrides,
  };
}

// A simple message payload builder for the get endpoint.
function message(id: string, threadId: string) {
  return {
    id,
    threadId,
    internalDate: '1700000000000',
    snippet: `snippet-${id}`,
    historyId: '500',
    payload: {
      mimeType: 'text/plain',
      headers: [{ name: 'Subject', value: `subj-${id}` }],
      body: { data: b64url(`body-${id}`) },
    },
  };
}

async function collect(
  it: AsyncIterable<AdapterEvent>
): Promise<AdapterEvent[]> {
  const events: AdapterEvent[] = [];
  for await (const ev of it) events.push(ev);
  return events;
}

describe('ingest — happy path (full sync)', function () {
  test('emits started -> auth -> message* -> completed with cursor and count', async function () {
    const fetchImpl = async function (url: string) {
      if (url.includes('/token')) return json(TOKEN_OK);
      if (url.includes('/profile'))
        return json({ emailAddress: 'u@g.com', historyId: '777' });
      if (/\/messages\/m\d+/.test(url)) {
        const id = url.match(/\/messages\/(m\d+)/)![1]!;
        return json(message(id, 't1'));
      }
      // list
      return json({
        messages: [
          { id: 'm1', threadId: 't1' },
          { id: 'm2', threadId: 't1' },
        ],
      });
    };
    const events = await collect(
      ingest(input(), { fetchImpl: fetchImpl as unknown as typeof fetch })
    );
    expect(events.map((e) => e.type)).toEqual([
      'started',
      'auth',
      'message',
      'message',
      'completed',
    ]);
    const auth = events[1];
    expect(auth.type === 'auth' && auth.refreshed).toBe(true);
    const completed = events[4];
    expect(completed.type).toBe('completed');
    if (completed.type === 'completed') {
      expect(completed.processed).toBe(2);
      expect(completed.cursor).toEqual({ historyId: '777' });
    }
  });

  test('each message event carries raw and a populated normalized', async function () {
    const fetchImpl = async function (url: string) {
      if (url.includes('/token')) return json(TOKEN_OK);
      if (url.includes('/profile'))
        return json({ emailAddress: 'u@g.com', historyId: '1' });
      if (/\/messages\/m\d+/.test(url)) return json(message('m1', 't1'));
      return json({ messages: [{ id: 'm1', threadId: 't1' }] });
    };
    const events = await collect(
      ingest(input({ spec: { type: 'full', limit: 1 } }), {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    );
    const msg = events.find((e) => e.type === 'message');
    expect(msg?.type).toBe('message');
    if (msg?.type === 'message') {
      expect(msg.raw.externalMessageId).toBe('m1');
      expect(msg.normalized?.subject).toBe('subj-m1');
      expect(msg.normalized?.bodyText).toBe('body-m1');
      expect(msg.attachments).toEqual([]);
    }
  });
});

describe('ingest — limit and pagination', function () {
  test('honors spec.limit across multiple pages', async function () {
    let listCalls = 0;
    const fetchImpl = async function (url: string) {
      if (url.includes('/token')) return json(TOKEN_OK);
      if (url.includes('/profile'))
        return json({ emailAddress: 'u@g.com', historyId: '9' });
      if (/\/messages\/m\d+/.test(url)) {
        const id = url.match(/\/messages\/(m\d+)/)![1]!;
        return json(message(id, 't1'));
      }
      listCalls += 1;
      // page 1 returns 2 ids + a nextPageToken; we should stop at limit=2 and not page again
      return json({
        messages: [
          { id: 'm1', threadId: 't1' },
          { id: 'm2', threadId: 't1' },
        ],
        nextPageToken: 'p2',
      });
    };
    const events = await collect(
      ingest(input({ spec: { type: 'full', limit: 2 } }), {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    );
    const messages = events.filter((e) => e.type === 'message');
    expect(messages).toHaveLength(2);
    expect(listCalls).toBe(1); // stopped at the cap, did not follow nextPageToken
  });

  test('follows nextPageToken when the cap is not yet reached', async function () {
    const pages: Record<string, unknown> = {
      first: { messages: [{ id: 'm1', threadId: 't1' }], nextPageToken: 'p2' },
      p2: { messages: [{ id: 'm2', threadId: 't1' }] },
    };
    const fetchImpl = async function (url: string) {
      if (url.includes('/token')) return json(TOKEN_OK);
      if (url.includes('/profile'))
        return json({ emailAddress: 'u@g.com', historyId: '9' });
      if (/\/messages\/m\d+/.test(url)) {
        const id = url.match(/\/messages\/(m\d+)/)![1]!;
        return json(message(id, 't1'));
      }
      const token = new URL(url).searchParams.get('pageToken');
      return json(token === 'p2' ? pages.p2 : pages.first);
    };
    const events = await collect(
      ingest(input({ spec: { type: 'full', limit: 10 } }), {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    );
    expect(events.filter((e) => e.type === 'message')).toHaveLength(2);
  });
});

describe('ingest — unsupported specs', function () {
  test('incremental throws not-implemented', async function () {
    const it = ingest(input({ spec: { type: 'incremental', cursor: {} } }), {
      fetchImpl: (async () => json({})) as unknown as typeof fetch,
    });
    await expect(collect(it)).rejects.toBeInstanceOf(GmailNotImplementedError);
  });

  test('range throws not-implemented', async function () {
    const it = ingest(input({ spec: { type: 'range' } }), {
      fetchImpl: (async () => json({})) as unknown as typeof fetch,
    });
    await expect(collect(it)).rejects.toBeInstanceOf(GmailNotImplementedError);
  });
});

describe('ingest — auth failures', function () {
  test('a revoked refresh token throws OAuth2RefreshError', async function () {
    const fetchImpl = async function (url: string) {
      if (url.includes('/token')) {
        return json({ error: 'invalid_grant' }, { status: 400 });
      }
      return json({});
    };
    const it = ingest(input(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(collect(it)).rejects.toBeInstanceOf(OAuth2RefreshError);
  });

  test('an expired token with no refresh token throws OAuth2NoRefreshTokenError', async function () {
    const creds = { accessToken: 'a', expiresAt: 0, tokenType: 'Bearer' };
    const it = ingest(input({ credentials: creds }), {
      fetchImpl: (async () => json({})) as unknown as typeof fetch,
    });
    await expect(collect(it)).rejects.toBeInstanceOf(OAuth2NoRefreshTokenError);
  });
});

describe('ingest — conditional refresh', function () {
  test('refresh emits the rotated credential on the auth event', async function () {
    const fetchImpl = async function (url: string) {
      if (url.includes('/token')) return json(TOKEN_OK);
      if (url.includes('/profile'))
        return json({ emailAddress: 'u@g.com', historyId: '1' });
      return json({ resultSizeEstimate: 0 });
    };
    const events = await collect(
      ingest(input(), { fetchImpl: fetchImpl as unknown as typeof fetch })
    );
    const auth = events.find((e) => e.type === 'auth');
    if (auth?.type === 'auth') {
      expect(auth.refreshed).toBe(true);
      expect(auth.credentials).toEqual({
        accessToken: 'fresh-access',
        refreshToken: 'r-new',
        expiresAt: expect.any(Number),
        scope: undefined,
        tokenType: 'Bearer',
      });
    } else {
      throw new Error('expected an auth event');
    }
  });

  test('a still-valid access token skips refresh (no /token call, refreshed:false, no credential)', async function () {
    let tokenCalled = false;
    const fetchImpl = async function (url: string) {
      if (url.includes('/token')) {
        tokenCalled = true;
        return json(TOKEN_OK);
      }
      if (url.includes('/profile'))
        return json({ emailAddress: 'u@g.com', historyId: '5' });
      return json({ resultSizeEstimate: 0 });
    };
    const validCreds = {
      accessToken: 'still-good',
      refreshToken: 'r-1',
      expiresAt: Date.now() + 3_600_000,
      tokenType: 'Bearer',
    };
    const events = await collect(
      ingest(input({ credentials: validCreds }), {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    );
    expect(tokenCalled).toBe(false);
    const auth = events.find((e) => e.type === 'auth');
    if (auth?.type === 'auth') {
      expect(auth.refreshed).toBe(false);
      expect(auth.credentials).toBeUndefined();
    } else {
      throw new Error('expected an auth event');
    }
  });
});

describe('ingest — fetch failures fail the sync (v0 loud)', function () {
  test('a message get failure throws GmailMessageFetchError', async function () {
    const fetchImpl = async function (url: string) {
      if (url.includes('/token')) return json(TOKEN_OK);
      if (url.includes('/profile'))
        return json({ emailAddress: 'u@g.com', historyId: '1' });
      if (/\/messages\/m\d+/.test(url))
        return json({ error: 'boom' }, { status: 500 });
      return json({ messages: [{ id: 'm1', threadId: 't1' }] });
    };
    const it = ingest(input({ spec: { type: 'full', limit: 1 } }), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(collect(it)).rejects.toBeInstanceOf(GmailMessageFetchError);
  });

  test('an attachment byte fetch failure throws GmailAttachmentFetchError', async function () {
    const msgWithAtt = {
      id: 'm1',
      threadId: 't1',
      internalDate: '1700000000000',
      payload: {
        mimeType: 'multipart/mixed',
        parts: [
          { mimeType: 'text/plain', body: { data: b64url('hi') } },
          {
            mimeType: 'application/pdf',
            filename: 'd.pdf',
            body: { size: 9, attachmentId: 'att-1' },
          },
        ],
      },
    };
    const fetchImpl = async function (url: string) {
      if (url.includes('/token')) return json(TOKEN_OK);
      if (url.includes('/profile'))
        return json({ emailAddress: 'u@g.com', historyId: '1' });
      if (url.includes('/attachments/'))
        return json({ error: 'nope' }, { status: 500 });
      if (/\/messages\/m\d+/.test(url)) return json(msgWithAtt);
      return json({ messages: [{ id: 'm1', threadId: 't1' }] });
    };
    const it = ingest(input({ spec: { type: 'full', limit: 1 } }), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(collect(it)).rejects.toBeInstanceOf(GmailAttachmentFetchError);
  });

  test('attachment bytes are fetched and emitted on the message event', async function () {
    const msgWithAtt = {
      id: 'm1',
      threadId: 't1',
      internalDate: '1700000000000',
      payload: {
        mimeType: 'multipart/mixed',
        parts: [
          { mimeType: 'text/plain', body: { data: b64url('hi') } },
          {
            mimeType: 'application/pdf',
            filename: 'd.pdf',
            body: { size: 5, attachmentId: 'att-1' },
          },
        ],
      },
    };
    const fetchImpl = async function (url: string) {
      if (url.includes('/token')) return json(TOKEN_OK);
      if (url.includes('/profile'))
        return json({ emailAddress: 'u@g.com', historyId: '1' });
      if (url.includes('/attachments/att-1'))
        return json({ size: 5, data: b64url('PDF!!') });
      if (/\/messages\/m\d+/.test(url)) return json(msgWithAtt);
      return json({ messages: [{ id: 'm1', threadId: 't1' }] });
    };
    const events = await collect(
      ingest(input({ spec: { type: 'full', limit: 1 } }), {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    );
    const msg = events.find((e) => e.type === 'message');
    if (msg?.type === 'message') {
      expect(msg.attachments).toHaveLength(1);
      expect(msg.attachments[0]?.externalAttachmentId).toBe('att-1');
      expect(msg.attachments[0]?.bytes.toString('utf8')).toBe('PDF!!');
    } else {
      throw new Error('expected a message event');
    }
  });
});

describe('ingest — empty mailbox', function () {
  test('emits started -> auth -> completed with zero processed', async function () {
    const fetchImpl = async function (url: string) {
      if (url.includes('/token')) return json(TOKEN_OK);
      if (url.includes('/profile'))
        return json({ emailAddress: 'u@g.com', historyId: '3' });
      return json({ resultSizeEstimate: 0 });
    };
    const events = await collect(
      ingest(input(), { fetchImpl: fetchImpl as unknown as typeof fetch })
    );
    expect(events.map((e) => e.type)).toEqual(['started', 'auth', 'completed']);
    const completed = events[2];
    if (completed.type === 'completed') {
      expect(completed.processed).toBe(0);
      expect(completed.cursor).toEqual({ historyId: '3' });
    }
  });
});

describe('ingest — concurrent fetch', function () {
  // A list of N ids on one page; each messages.get can be delayed individually.
  function fanoutFetch(opts: {
    ids: string[];
    delayMs?: (id: string) => number;
    onGetActive?: (active: number) => void;
  }) {
    let active = 0;
    return async function (url: string) {
      if (url.includes('/token')) return json(TOKEN_OK);
      if (url.includes('/profile'))
        return json({ emailAddress: 'u@g.com', historyId: '1' });
      if (/\/messages\/m\d+/.test(url)) {
        const id = url.match(/\/messages\/(m\d+)/)![1]!;
        active += 1;
        opts.onGetActive?.(active);
        await new Promise((r) => setTimeout(r, opts.delayMs?.(id) ?? 1));
        active -= 1;
        return json(message(id, 't1'));
      }
      return json({ messages: opts.ids.map((id) => ({ id, threadId: 't1' })) });
    };
  }

  test('fetches messages concurrently up to fetchConcurrency, never more', async function () {
    const ids = Array.from({ length: 12 }, (_, i) => `m${i + 1}`);
    let max = 0;
    const fetchImpl = fanoutFetch({
      ids,
      delayMs: () => 10,
      onGetActive: (a) => {
        max = Math.max(max, a);
      },
    });
    const events = await collect(
      ingest(input({ spec: { type: 'full', limit: 12 } }), {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        fetchConcurrency: 3,
      })
    );
    expect(events.filter((e) => e.type === 'message')).toHaveLength(12);
    expect(max).toBe(3);
  });

  test('emits in completion order (a slow message yields after a fast sibling)', async function () {
    // m1 is slow; m2/m3 are fast — so the slow one is not first.
    const fetchImpl = fanoutFetch({
      ids: ['m1', 'm2', 'm3'],
      delayMs: (id) => (id === 'm1' ? 30 : 1),
    });
    const events = await collect(
      ingest(input({ spec: { type: 'full', limit: 3 } }), {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        fetchConcurrency: 3,
      })
    );
    const msgIds = events
      .filter((e) => e.type === 'message')
      .map((e) => (e.type === 'message' ? e.raw.externalMessageId : ''));
    // All three arrive (order is completion-based, so assert on the set), and the
    // slow m1 is not the first to land.
    expect(new Set(msgIds)).toEqual(new Set(['m1', 'm2', 'm3']));
    expect(msgIds[0]).not.toBe('m1');
  });

  test('respects the cap exactly under concurrency, across pages', async function () {
    let listCalls = 0;
    const fetchImpl = async function (url: string) {
      if (url.includes('/token')) return json(TOKEN_OK);
      if (url.includes('/profile'))
        return json({ emailAddress: 'u@g.com', historyId: '1' });
      if (/\/messages\/m\d+/.test(url)) {
        const id = url.match(/\/messages\/(m\d+)/)![1]!;
        return json(message(id, 't1'));
      }
      listCalls += 1;
      return json({
        messages: [
          { id: 'm1', threadId: 't1' },
          { id: 'm2', threadId: 't1' },
          { id: 'm3', threadId: 't1' },
        ],
        nextPageToken: 'p2',
      });
    };
    const events = await collect(
      ingest(input({ spec: { type: 'full', limit: 2 } }), {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        fetchConcurrency: 5,
      })
    );
    const messages = events.filter((e) => e.type === 'message');
    expect(messages).toHaveLength(2); // capped at 2 even though the page had 3
    expect(listCalls).toBe(1); // did not follow nextPageToken past the cap
    const completed = events.find((e) => e.type === 'completed');
    if (completed?.type === 'completed') expect(completed.processed).toBe(2);
  });

  test('one failed get fails the whole sync, no completed event', async function () {
    const fetchImpl = async function (url: string) {
      if (url.includes('/token')) return json(TOKEN_OK);
      if (url.includes('/profile'))
        return json({ emailAddress: 'u@g.com', historyId: '1' });
      if (/\/messages\/m2/.test(url))
        return json({ error: 'boom' }, { status: 500 });
      if (/\/messages\/m\d+/.test(url)) {
        const id = url.match(/\/messages\/(m\d+)/)![1]!;
        return json(message(id, 't1'));
      }
      return json({
        messages: [
          { id: 'm1', threadId: 't1' },
          { id: 'm2', threadId: 't1' },
          { id: 'm3', threadId: 't1' },
        ],
      });
    };
    const it = ingest(input({ spec: { type: 'full', limit: 3 } }), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      fetchConcurrency: 3,
    });
    await expect(collect(it)).rejects.toBeInstanceOf(GmailMessageFetchError);
  });
});
