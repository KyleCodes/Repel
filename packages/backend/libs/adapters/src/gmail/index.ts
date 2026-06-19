import { Channel } from '@repel/enums';
import type { Capabilities, IProviderAdapter } from '../types';
import { gmailAuth } from './auth';
import { send } from './egress/send';
import { ingest } from './ingress/ingest';
import { normalizeGmailMessage } from './normalize';

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
