import { Channel } from '@repel/enums';
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
  ingest: (input) => ingest(input),
  send,
  normalize: normalizeGmailMessage,
};
