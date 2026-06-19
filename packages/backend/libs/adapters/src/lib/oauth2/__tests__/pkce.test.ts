import { createHash } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import { generatePkce, generateState } from '../pkce';

const BASE64URL = /^[A-Za-z0-9_-]+$/;

function base64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

describe('generatePkce', function () {
  test('returns base64url verifier and challenge (no +, /, = chars)', function () {
    const { verifier, challenge } = generatePkce();
    expect(verifier).toMatch(BASE64URL);
    expect(challenge).toMatch(BASE64URL);
  });

  test('verifier is 43 chars (32 random bytes base64url)', function () {
    const { verifier } = generatePkce();
    expect(verifier.length).toBe(43);
  });

  test('challenge equals base64url(sha256(verifier)) recomputed independently', function () {
    const { verifier, challenge } = generatePkce();
    const expected = base64url(createHash('sha256').update(verifier).digest());
    expect(challenge).toBe(expected);
  });

  test('two calls produce distinct verifiers and challenges', function () {
    const a = generatePkce();
    const b = generatePkce();
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.challenge).not.toBe(b.challenge);
  });
});

describe('generateState', function () {
  test('returns a non-empty base64url string', function () {
    const state = generateState();
    expect(state.length).toBeGreaterThan(0);
    expect(state).toMatch(BASE64URL);
  });

  test('two calls differ', function () {
    expect(generateState()).not.toBe(generateState());
  });
});
