import { Channel } from '@repel/shared';
import type { Capabilities, IProviderAdapter } from '../types.ts';
import { gmailAuth } from './auth.ts';
import { send } from './egress/send.ts';
import { ingest } from './ingress/ingest.ts';
import { normalizeGmailMessage } from './normalize.ts';

export const gmailCapabilities: Capabilities = {
  channel: Channel.email,
  canSend: false,
  canReceive: true,
  ingressMode: 'poll',
};

export const gmailAdapter: IProviderAdapter = {
  capabilities: gmailCapabilities,
  auth: gmailAuth,
  // ingest is wrapped so the contract's 1-arg signature is preserved while the
  // implementation keeps an injectable fetch seam for tests.
  ingest: (input) => ingest(input),
  send,
  normalize: normalizeGmailMessage,
};
