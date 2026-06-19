import { describe, expect, test } from 'bun:test';
import { ProviderNotFoundError } from '../error';
import { gmailAdapter } from '../gmail/index';
import { resolveProviderAdapter } from '../registry';

describe('resolveProviderAdapter', function () {
  test('returns the gmail adapter for the gmail slug', function () {
    const adapter = resolveProviderAdapter('gmail');
    expect(adapter).toBe(gmailAdapter);
    expect(adapter.auth.method).toBe('oauth2');
  });

  test('throws ProviderNotFoundError for icloud (no adapter registered)', function () {
    let caught: unknown;
    try {
      resolveProviderAdapter('icloud');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ProviderNotFoundError);
    expect((caught as ProviderNotFoundError).message).toContain('icloud');
  });

  test('throws ProviderNotFoundError for generic_imap (no adapter registered)', function () {
    let caught: unknown;
    try {
      resolveProviderAdapter('generic_imap');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ProviderNotFoundError);
    expect((caught as ProviderNotFoundError).message).toContain('generic_imap');
  });
});
