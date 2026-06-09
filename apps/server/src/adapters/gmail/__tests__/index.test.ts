import { describe, expect, test } from 'bun:test';
import { Channel } from '@repel/shared';
import { AdapterError } from '../../error.ts';
import type {
  IProviderAdapter,
  IngestInput,
  RawMessage,
  SendInput,
} from '../../types.ts';
import { GmailNotImplementedError } from '../error.ts';
import { gmailAdapter, gmailCapabilities } from '../index.ts';

// Compile-time assignability: gmailAdapter must satisfy the contract.
const _contract: IProviderAdapter = gmailAdapter;
void _contract;

const sendInput: SendInput = {
  orgId: 'org',
  userId: 'user',
  providerAccountId: 'pa',
  to: ['x@y.com'],
};

const ingestInput: IngestInput = {
  orgId: 'org',
  userId: 'user',
  providerAccountId: 'pa',
  spec: { type: 'full' },
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

describe('gmailAdapter stubs', function () {
  test('send rejects with GmailNotImplementedError (an AdapterError)', async function () {
    let caught: unknown;
    try {
      await gmailAdapter.send(sendInput);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GmailNotImplementedError);
    expect(caught).toBeInstanceOf(AdapterError);
  });

  test('normalize throws GmailNotImplementedError', function () {
    expect(function () {
      gmailAdapter.normalize({} as RawMessage);
    }).toThrow(GmailNotImplementedError);
  });

  test('ingest iteration throws GmailNotImplementedError', async function () {
    let caught: unknown;
    try {
      for await (const _event of gmailAdapter.ingest(ingestInput)) {
        void _event;
      }
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GmailNotImplementedError);
  });
});

describe('adapters barrel', function () {
  test('re-exports gmailAdapter and gmailCapabilities', async function () {
    const barrel = await import('../../index.ts');
    expect(barrel.gmailAdapter).toBeDefined();
    expect(barrel.gmailCapabilities).toBeDefined();
  });
});
