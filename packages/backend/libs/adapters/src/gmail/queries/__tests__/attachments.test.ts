import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { getGmailAttachment } from '../attachments';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('getGmailAttachment', function () {
  test('hits the attachment endpoint with a Bearer header and decodes base64url bytes', async function () {
    let seenAuth: string | undefined;
    let seenUrl: string | undefined;
    // "hello" -> base64url "aGVsbG8" (no padding)
    const fetchImpl = async function (url: string, init?: RequestInit) {
      seenUrl = url;
      seenAuth = new Headers(init?.headers).get('authorization') ?? undefined;
      return jsonResponse({ size: 5, data: 'aGVsbG8' });
    };
    const bytes = await getGmailAttachment(
      { accessToken: 'tok-abc', messageId: 'm1', attachmentId: 'att-1' },
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );
    expect(seenAuth).toBe('Bearer tok-abc');
    expect(seenUrl).toContain(
      '/gmail/v1/users/me/messages/m1/attachments/att-1'
    );
    expect(bytes).toBeInstanceOf(Buffer);
    expect(bytes.toString('utf8')).toBe('hello');
  });

  test('decodes base64url with URL-safe chars (- and _)', async function () {
    // bytes [0xfb, 0xff] -> standard base64 "+/8=" -> base64url "-_8"
    const fetchImpl = async function () {
      return jsonResponse({ size: 2, data: '-_8' });
    };
    const bytes = await getGmailAttachment(
      { accessToken: 'tok', messageId: 'm1', attachmentId: 'att-1' },
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );
    expect([...bytes]).toEqual([0xfb, 0xff]);
  });

  test('rejects with a raw ZodError when data is missing', async function () {
    const fetchImpl = async function () {
      return jsonResponse({ size: 0 });
    };
    let caught: unknown;
    try {
      await getGmailAttachment(
        { accessToken: 'tok', messageId: 'm1', attachmentId: 'att-1' },
        { fetchImpl: fetchImpl as unknown as typeof fetch }
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(z.ZodError);
  });
});
