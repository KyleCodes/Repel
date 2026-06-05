import { Channel } from '@repel/shared';
import type {
  AdapterEvent,
  Capabilities,
  IProviderAdapter,
  IngestInput,
  NormalizedMessage,
  RawMessage,
} from '../types.ts';
import { promptUserAuthorization } from './auth.ts';
import { send } from './egress/send.ts';
import { GmailNotImplementedError } from './error.ts';

export const gmailCapabilities: Capabilities = {
  channel: Channel.email,
  canSend: false,
  canReceive: true,
  ingressMode: 'poll',
};

// ingest and normalize are throwing stubs at this stage — interactive auth is
// the only real member. The signatures match the contract so the instance
// typechecks; the throws are runtime.
async function* ingestStub(_input: IngestInput): AsyncIterable<AdapterEvent> {
  throw new GmailNotImplementedError('Gmail ingest is not implemented yet');
}

function normalizeStub(_raw: RawMessage): NormalizedMessage {
  throw new GmailNotImplementedError('Gmail normalize is not implemented yet');
}

export const gmailAdapter: IProviderAdapter = {
  capabilities: gmailCapabilities,
  promptUserAuthorization,
  ingest: ingestStub,
  send,
  normalize: normalizeStub,
};
