import { createHash, randomBytes } from 'node:crypto';

export interface Pkce {
  readonly verifier: string;
  readonly challenge: string;
}

function base64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// PKCE (RFC 7636, S256). 32 random bytes → a 43-char base64url verifier; the
// challenge is base64url(sha256(verifier)). The verifier never leaves the
// process — only the challenge is sent to the provider.
export function generatePkce(): Pkce {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

// A CSRF nonce echoed back by the provider on redirect. Not a secret — compared
// with plain equality — so plain entropy is sufficient.
export function generateState(): string {
  return base64url(randomBytes(32));
}
