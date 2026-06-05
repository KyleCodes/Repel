import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { getGmailProfile } from '../profile.ts';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('getGmailProfile', function () {
  test('sends a Bearer header and returns the parsed profile', async function () {
    let seenAuth: string | undefined;
    let seenUrl: string | undefined;
    const fetchImpl = async function (url: string, init?: RequestInit) {
      seenUrl = url;
      seenAuth = new Headers(init?.headers).get('authorization') ?? undefined;
      return jsonResponse({
        emailAddress: 'User@Gmail.com',
        messagesTotal: 10,
        threadsTotal: 4,
        historyId: '12345',
      });
    };
    const profile = await getGmailProfile(
      { accessToken: 'tok-abc' },
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );
    expect(seenAuth).toBe('Bearer tok-abc');
    expect(seenUrl).toContain('/gmail/v1/users/me/profile');
    expect(profile.emailAddress).toBe('User@Gmail.com');
  });

  test('rejects with a raw ZodError when emailAddress is missing', async function () {
    const fetchImpl = async function () {
      return jsonResponse({ messagesTotal: 1 });
    };
    let caught: unknown;
    try {
      await getGmailProfile(
        { accessToken: 'tok' },
        { fetchImpl: fetchImpl as unknown as typeof fetch }
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(z.ZodError);
  });
});
