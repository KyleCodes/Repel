import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { getGmailMessage, listGmailMessages } from '../messages';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('listGmailMessages', function () {
  test('sends a Bearer header, hits the messages endpoint, parses the page', async function () {
    let seenAuth: string | undefined;
    let seenUrl: string | undefined;
    const fetchImpl = async function (url: string, init?: RequestInit) {
      seenUrl = url;
      seenAuth = new Headers(init?.headers).get('authorization') ?? undefined;
      return jsonResponse({
        messages: [
          { id: 'm1', threadId: 't1' },
          { id: 'm2', threadId: 't1' },
        ],
        nextPageToken: 'page-2',
        resultSizeEstimate: 2,
      });
    };
    const page = await listGmailMessages(
      { accessToken: 'tok-abc' },
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );
    expect(seenAuth).toBe('Bearer tok-abc');
    expect(seenUrl).toContain('/gmail/v1/users/me/messages');
    expect(page.messages).toHaveLength(2);
    expect(page.messages?.[0]).toEqual({ id: 'm1', threadId: 't1' });
    expect(page.nextPageToken).toBe('page-2');
  });

  test('passes pageToken and maxResults as query params', async function () {
    let seenUrl: string | undefined;
    const fetchImpl = async function (url: string) {
      seenUrl = url;
      return jsonResponse({ resultSizeEstimate: 0 });
    };
    await listGmailMessages(
      { accessToken: 'tok', pageToken: 'page-2', maxResults: 17 },
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );
    expect(seenUrl).toContain('pageToken=page-2');
    expect(seenUrl).toContain('maxResults=17');
  });

  test('passes q (the Gmail search query) as a query param', async function () {
    let seenUrl: string | undefined;
    const fetchImpl = async function (url: string) {
      seenUrl = url;
      return jsonResponse({ resultSizeEstimate: 0 });
    };
    await listGmailMessages(
      { accessToken: 'tok', q: 'after:1700000000 before:1700086400' },
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );
    // URLSearchParams encodes the space and colons.
    expect(seenUrl).toContain('q=after%3A1700000000+before%3A1700086400');
  });

  test('omits pageToken and maxResults when not given', async function () {
    let seenUrl: string | undefined;
    const fetchImpl = async function (url: string) {
      seenUrl = url;
      return jsonResponse({ resultSizeEstimate: 0 });
    };
    await listGmailMessages(
      { accessToken: 'tok' },
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );
    expect(seenUrl).not.toContain('pageToken');
    expect(seenUrl).not.toContain('maxResults');
  });

  test('handles an empty mailbox (no messages array)', async function () {
    const fetchImpl = async function () {
      return jsonResponse({ resultSizeEstimate: 0 });
    };
    const page = await listGmailMessages(
      { accessToken: 'tok' },
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );
    expect(page.messages).toBeUndefined();
    expect(page.nextPageToken).toBeUndefined();
  });
});

describe('getGmailMessage', function () {
  test('requests format=full and parses a recursive payload tree', async function () {
    let seenUrl: string | undefined;
    const fetchImpl = async function (url: string) {
      seenUrl = url;
      return jsonResponse({
        id: 'm1',
        threadId: 't1',
        internalDate: '1700000000000',
        snippet: 'hello',
        historyId: '99',
        payload: {
          mimeType: 'multipart/alternative',
          headers: [{ name: 'Subject', value: 'Hi' }],
          parts: [
            {
              mimeType: 'text/plain',
              body: { size: 5, data: 'aGVsbG8' },
            },
            {
              mimeType: 'text/html',
              body: { size: 12, data: 'PGI-aGVsbG88L2I-' },
            },
          ],
        },
      });
    };
    const msg = await getGmailMessage(
      { accessToken: 'tok', id: 'm1' },
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );
    expect(seenUrl).toContain('/gmail/v1/users/me/messages/m1');
    expect(seenUrl).toContain('format=full');
    expect(msg.id).toBe('m1');
    expect(msg.internalDate).toBe('1700000000000');
    expect(msg.payload.parts).toHaveLength(2);
    expect(msg.payload.parts?.[0]?.mimeType).toBe('text/plain');
  });

  test('parses a deeply nested multipart tree', async function () {
    const fetchImpl = async function () {
      return jsonResponse({
        id: 'm2',
        threadId: 't2',
        internalDate: '1700000000001',
        payload: {
          mimeType: 'multipart/mixed',
          parts: [
            {
              mimeType: 'multipart/alternative',
              parts: [
                { mimeType: 'text/plain', body: { data: 'YQ' } },
                { mimeType: 'text/html', body: { data: 'Yg' } },
              ],
            },
            {
              mimeType: 'application/pdf',
              filename: 'doc.pdf',
              body: { size: 1024, attachmentId: 'att-1' },
            },
          ],
        },
      });
    };
    const msg = await getGmailMessage(
      { accessToken: 'tok', id: 'm2' },
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );
    const nested = msg.payload.parts?.[0];
    expect(nested?.mimeType).toBe('multipart/alternative');
    expect(nested?.parts).toHaveLength(2);
    expect(msg.payload.parts?.[1]?.filename).toBe('doc.pdf');
    expect(msg.payload.parts?.[1]?.body?.attachmentId).toBe('att-1');
  });

  test('rejects with a raw ZodError when internalDate is missing', async function () {
    const fetchImpl = async function () {
      return jsonResponse({ id: 'm1', threadId: 't1', payload: {} });
    };
    let caught: unknown;
    try {
      await getGmailMessage(
        { accessToken: 'tok', id: 'm1' },
        { fetchImpl: fetchImpl as unknown as typeof fetch }
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(z.ZodError);
  });
});
