import type { SendInput } from '../../types.ts';
import { GmailNotImplementedError } from '../error.ts';

// Gmail send is not enabled at this stage — capabilities.canSend is false. The
// signature matches the contract so the adapter typechecks; the throw is
// runtime.
export function send(
  _input: SendInput
): Promise<{ providerMessageId: string }> {
  throw new GmailNotImplementedError('Gmail send is not implemented yet');
}
