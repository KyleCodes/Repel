import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { Channel } from '@repel/shared';
import type { RawMessage } from '../../types.ts';
import {
  GMAIL_PAYLOAD_SCHEMA,
  buildGmailRawMessage,
  normalizeGmailMessage,
} from '../normalize.ts';
import type { GmailMessage } from '../queries/messages.ts';

const CTX = {
  orgId: 'org-1',
  userId: 'user-1',
  providerAccountId: 'pa-1',
} as const;

// base64url helper for fixtures.
function b64url(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64url');
}

// Build a RawMessage from a GmailMessage the way the adapter does, so normalize
// tests run against the persisted shape (payload as Json).
function raw(msg: GmailMessage): RawMessage {
  return buildGmailRawMessage(msg, CTX);
}

function baseMsg(overrides: Partial<GmailMessage>): GmailMessage {
  return {
    id: 'm1',
    threadId: 't1',
    internalDate: '1700000000000',
    payload: { mimeType: 'text/plain', body: { data: b64url('hi') } },
    ...overrides,
  };
}

describe('buildGmailRawMessage', function () {
  test('stamps context, channel, externalMessageId, payload schema', function () {
    const r = buildGmailRawMessage(baseMsg({ id: 'abc' }), CTX);
    expect(r.orgId).toBe('org-1');
    expect(r.userId).toBe('user-1');
    expect(r.providerAccountId).toBe('pa-1');
    expect(r.channel).toBe(Channel.email);
    expect(r.externalMessageId).toBe('abc');
    expect(r.payloadSchema).toBe(GMAIL_PAYLOAD_SCHEMA);
  });
});

describe('normalizeGmailMessage — determinism & purity', function () {
  test('same input yields deeply equal output every call', function () {
    const r = raw(baseMsg({}));
    expect(normalizeGmailMessage(r)).toEqual(normalizeGmailMessage(r));
  });

  test('maps ids, threadId, and internalDate -> sentAt', function () {
    const out = normalizeGmailMessage(
      raw(
        baseMsg({ id: 'm9', threadId: 'thr-9', internalDate: '1700000000000' })
      )
    );
    expect(out.externalMessageId).toBe('m9');
    expect(out.externalThreadId).toBe('thr-9');
    expect(out.sentAt).toEqual(new Date(1700000000000));
    expect(out.receivedAt).toBeNull();
    expect(out.channel).toBe(Channel.email);
  });
});

describe('normalizeGmailMessage — body precedence', function () {
  test('plain-only single part', function () {
    const out = normalizeGmailMessage(
      raw(
        baseMsg({
          payload: {
            mimeType: 'text/plain',
            body: { data: b64url('plain body') },
          },
        })
      )
    );
    expect(out.bodyText).toBe('plain body');
    expect(out.bodyHtml).toBeNull();
  });

  test('html-only single part', function () {
    const out = normalizeGmailMessage(
      raw(
        baseMsg({
          payload: {
            mimeType: 'text/html',
            body: { data: b64url('<b>x</b>') },
          },
        })
      )
    );
    expect(out.bodyText).toBeNull();
    expect(out.bodyHtml).toBe('<b>x</b>');
  });

  test('multipart/alternative captures BOTH text and html', function () {
    const out = normalizeGmailMessage(
      raw(
        baseMsg({
          payload: {
            mimeType: 'multipart/alternative',
            parts: [
              { mimeType: 'text/plain', body: { data: b64url('the text') } },
              {
                mimeType: 'text/html',
                body: { data: b64url('<p>the html</p>') },
              },
            ],
          },
        })
      )
    );
    expect(out.bodyText).toBe('the text');
    expect(out.bodyHtml).toBe('<p>the html</p>');
  });

  test('first-leaf-wins per mimeType when duplicates exist', function () {
    const out = normalizeGmailMessage(
      raw(
        baseMsg({
          payload: {
            mimeType: 'multipart/mixed',
            parts: [
              { mimeType: 'text/plain', body: { data: b64url('first') } },
              { mimeType: 'text/plain', body: { data: b64url('second') } },
            ],
          },
        })
      )
    );
    expect(out.bodyText).toBe('first');
  });

  test('nested mixed > alternative, body found below an attachment sibling', function () {
    const out = normalizeGmailMessage(
      raw(
        baseMsg({
          payload: {
            mimeType: 'multipart/mixed',
            parts: [
              {
                mimeType: 'multipart/alternative',
                parts: [
                  {
                    mimeType: 'text/plain',
                    body: { data: b64url('nested text') },
                  },
                  {
                    mimeType: 'text/html',
                    body: { data: b64url('<i>nested</i>') },
                  },
                ],
              },
              {
                mimeType: 'application/pdf',
                filename: 'doc.pdf',
                body: { size: 10, attachmentId: 'att-1' },
              },
            ],
          },
        })
      )
    );
    expect(out.bodyText).toBe('nested text');
    expect(out.bodyHtml).toBe('<i>nested</i>');
  });

  test('an attached .txt file is NOT picked as the body', function () {
    const out = normalizeGmailMessage(
      raw(
        baseMsg({
          payload: {
            mimeType: 'multipart/mixed',
            parts: [
              {
                mimeType: 'text/html',
                body: { data: b64url('<p>real body</p>') },
              },
              {
                mimeType: 'text/plain',
                filename: 'notes.txt',
                body: { size: 4, attachmentId: 'att-9', data: b64url('NOTE') },
              },
            ],
          },
        })
      )
    );
    expect(out.bodyHtml).toBe('<p>real body</p>');
    expect(out.bodyText).toBeNull();
    expect(out.attachments).toHaveLength(1);
    expect(out.attachments[0]?.filename).toBe('notes.txt');
  });
});

describe('normalizeGmailMessage — headers', function () {
  test('case-insensitive header lookup for subject and threading ids', function () {
    const out = normalizeGmailMessage(
      raw(
        baseMsg({
          payload: {
            mimeType: 'text/plain',
            headers: [
              { name: 'sUbJeCt', value: 'Re: hello' },
              { name: 'Message-ID', value: '<abc@mail>' },
              { name: 'In-Reply-To', value: '<prev@mail>' },
              { name: 'References', value: '<a@mail> <b@mail>  <c@mail>' },
            ],
            body: { data: b64url('x') },
          },
        })
      )
    );
    expect(out.subject).toBe('Re: hello');
    expect(out.messageIdHeader).toBe('<abc@mail>');
    expect(out.inReplyTo).toBe('<prev@mail>');
    expect(out.references).toEqual(['<a@mail>', '<b@mail>', '<c@mail>']);
  });

  test('missing optional headers normalize to null', function () {
    const out = normalizeGmailMessage(
      raw(
        baseMsg({
          payload: { mimeType: 'text/plain', body: { data: b64url('x') } },
        })
      )
    );
    expect(out.subject).toBeNull();
    expect(out.messageIdHeader).toBeNull();
    expect(out.inReplyTo).toBeNull();
    expect(out.references).toBeNull();
  });

  test('snippet comes from the message, not a header', function () {
    const out = normalizeGmailMessage(
      raw(baseMsg({ snippet: 'a short snippet' }))
    );
    expect(out.snippet).toBe('a short snippet');
  });
});

describe('normalizeGmailMessage — participants', function () {
  test('extracts from/to/cc/bcc with display names and bare addresses', function () {
    const out = normalizeGmailMessage(
      raw(
        baseMsg({
          payload: {
            mimeType: 'text/plain',
            headers: [
              { name: 'From', value: 'Alice Example <alice@example.com>' },
              {
                name: 'To',
                value: 'bob@example.com, Carol <carol@example.com>',
              },
              { name: 'Cc', value: 'dan@example.com' },
              { name: 'Bcc', value: '"Eve, the Last" <eve@example.com>' },
            ],
            body: { data: b64url('x') },
          },
        })
      )
    );
    expect(out.participants).toEqual([
      {
        role: 'from',
        handle: 'alice@example.com',
        displayName: 'Alice Example',
      },
      { role: 'to', handle: 'bob@example.com', displayName: null },
      { role: 'to', handle: 'carol@example.com', displayName: 'Carol' },
      { role: 'cc', handle: 'dan@example.com', displayName: null },
      { role: 'bcc', handle: 'eve@example.com', displayName: 'Eve, the Last' },
    ]);
  });

  test('no address headers -> empty participants', function () {
    const out = normalizeGmailMessage(
      raw(
        baseMsg({
          payload: { mimeType: 'text/plain', body: { data: b64url('x') } },
        })
      )
    );
    expect(out.participants).toEqual([]);
  });
});

describe('normalizeGmailMessage — attachments', function () {
  test('captures attachment metadata (no bytes) incl. inline image with contentId', function () {
    const out = normalizeGmailMessage(
      raw(
        baseMsg({
          payload: {
            mimeType: 'multipart/mixed',
            parts: [
              { mimeType: 'text/html', body: { data: b64url('<p>body</p>') } },
              {
                mimeType: 'application/pdf',
                filename: 'report.pdf',
                headers: [
                  {
                    name: 'Content-Disposition',
                    value: 'attachment; filename="report.pdf"',
                  },
                ],
                body: { size: 2048, attachmentId: 'att-pdf' },
              },
              {
                mimeType: 'image/png',
                filename: 'logo.png',
                headers: [
                  { name: 'Content-Disposition', value: 'inline' },
                  { name: 'Content-ID', value: '<logo@cid>' },
                ],
                body: { size: 512, attachmentId: 'att-img' },
              },
            ],
          },
        })
      )
    );
    expect(out.attachments).toEqual([
      {
        filename: 'report.pdf',
        contentType: 'application/pdf',
        sizeBytes: 2048,
        externalAttachmentId: 'att-pdf',
        contentId: null,
        disposition: 'attachment',
      },
      {
        filename: 'logo.png',
        contentType: 'image/png',
        sizeBytes: 512,
        externalAttachmentId: 'att-img',
        contentId: '<logo@cid>',
        disposition: 'inline',
      },
    ]);
  });

  test('no attachments -> empty array', function () {
    const out = normalizeGmailMessage(
      raw(
        baseMsg({
          payload: { mimeType: 'text/plain', body: { data: b64url('x') } },
        })
      )
    );
    expect(out.attachments).toEqual([]);
  });
});

describe('normalizeGmailMessage — defensive re-parse', function () {
  test('throws a raw ZodError when the stored payload is malformed', function () {
    const bad: RawMessage = {
      orgId: 'o',
      userId: 'u',
      providerAccountId: 'p',
      channel: Channel.email,
      externalMessageId: 'm',
      payloadSchema: GMAIL_PAYLOAD_SCHEMA,
      payload: { id: 'm', threadId: 't' }, // missing internalDate + payload
    };
    let caught: unknown;
    try {
      normalizeGmailMessage(bad);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(z.ZodError);
  });
});
