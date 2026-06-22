import { describe, expect, test } from 'bun:test';
import { Channel } from '@repel/enums';
import { AdapterError } from '../../error';
import type { IProviderAdapter, SendInput } from '../../types';
import { GmailNotImplementedError } from '../error';
import { gmailAdapter, gmailCapabilities } from '../index';
import { normalizeGmailMessage } from '../normalize';

// Compile-time assignability: gmailAdapter must satisfy the contract.
const _contract: IProviderAdapter = gmailAdapter;
void _contract;

const sendInput: SendInput = {
  orgId: 'org',
  userId: 'user',
  providerAccountId: 'pa',
  to: ['x@y.com'],
};

describe('gmailCapabilities', function () {
  test('declares email, poll ingress, receive-only', function () {
    expect(gmailCapabilities).toEqual({
      channel: Channel.email,
      canSend: false,
      canReceive: true,
      ingressMode: 'poll',
    });
  });

  test('auth method is oauth2', function () {
    expect(gmailAdapter.auth.method).toBe('oauth2');
  });

  test('canSend is false', function () {
    expect(gmailCapabilities.canSend).toBe(false);
  });
});

describe('gmailAdapter wiring', function () {
  test('send is still a stub — rejects with GmailNotImplementedError', async function () {
    let caught: unknown;
    try {
      await gmailAdapter.send(sendInput);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GmailNotImplementedError);
    expect(caught).toBeInstanceOf(AdapterError);
  });

  test('normalize is wired to the real implementation', function () {
    expect(gmailAdapter.normalize).toBe(normalizeGmailMessage);
  });

  test('ingest returns an async iterable', function () {
    const it = gmailAdapter.ingest({
      providerSlug: 'gmail',
      orgId: 'org',
      userId: 'user',
      providerAccountId: 'pa',
      spec: { type: 'full', limit: 1 },
      credentials: {
        accessToken: 'a',
        refreshToken: 'r',
        expiresAt: 0,
        tokenType: 'Bearer',
      },
    });
    expect(typeof (it as AsyncIterable<unknown>)[Symbol.asyncIterator]).toBe(
      'function'
    );
  });
});
