import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  GMAIL_AUTH_ENDPOINT,
  GMAIL_SCOPES,
  GMAIL_TOKEN_ENDPOINT,
  loadGmailOAuthConfig,
  withRedirectUri,
} from '../oauth';

let originalId: string | undefined;
let originalSecret: string | undefined;

beforeEach(function () {
  originalId = process.env.REPEL_GMAIL_CLIENT_ID;
  originalSecret = process.env.REPEL_GMAIL_CLIENT_SECRET;
});

afterEach(function () {
  if (originalId === undefined) delete process.env.REPEL_GMAIL_CLIENT_ID;
  else process.env.REPEL_GMAIL_CLIENT_ID = originalId;
  if (originalSecret === undefined)
    delete process.env.REPEL_GMAIL_CLIENT_SECRET;
  else process.env.REPEL_GMAIL_CLIENT_SECRET = originalSecret;
});

describe('GMAIL_SCOPES', function () {
  test('requests exactly the read-only Gmail scope', function () {
    expect(GMAIL_SCOPES).toEqual([
      'https://www.googleapis.com/auth/gmail.readonly',
    ]);
  });
});

describe('loadGmailOAuthConfig', function () {
  test('builds a config from env + constants when both vars are set', function () {
    process.env.REPEL_GMAIL_CLIENT_ID = 'id-123';
    process.env.REPEL_GMAIL_CLIENT_SECRET = 'secret-456';
    const config = loadGmailOAuthConfig();
    expect(config.clientId).toBe('id-123');
    expect(config.clientSecret).toBe('secret-456');
    expect(config.authEndpoint).toBe(GMAIL_AUTH_ENDPOINT);
    expect(config.tokenEndpoint).toBe(GMAIL_TOKEN_ENDPOINT);
    expect(config.scopes).toEqual(GMAIL_SCOPES);
  });

  test('omits redirectUri — it is added once the loopback port is known', function () {
    process.env.REPEL_GMAIL_CLIENT_ID = 'id-123';
    process.env.REPEL_GMAIL_CLIENT_SECRET = 'secret-456';
    const config = loadGmailOAuthConfig();
    expect('redirectUri' in config).toBe(false);
  });

  test('sets extraAuthParams to force a refresh token', function () {
    process.env.REPEL_GMAIL_CLIENT_ID = 'id-123';
    process.env.REPEL_GMAIL_CLIENT_SECRET = 'secret-456';
    const config = loadGmailOAuthConfig();
    expect(config.extraAuthParams?.access_type).toBe('offline');
    expect(config.extraAuthParams?.prompt).toBe('consent');
  });

  test('throws naming REPEL_GMAIL_CLIENT_ID when it is missing', function () {
    delete process.env.REPEL_GMAIL_CLIENT_ID;
    process.env.REPEL_GMAIL_CLIENT_SECRET = 'secret-456';
    expect(function () {
      loadGmailOAuthConfig();
    }).toThrow(/REPEL_GMAIL_CLIENT_ID/);
  });

  test('throws naming REPEL_GMAIL_CLIENT_SECRET when it is missing', function () {
    process.env.REPEL_GMAIL_CLIENT_ID = 'id-123';
    delete process.env.REPEL_GMAIL_CLIENT_SECRET;
    expect(function () {
      loadGmailOAuthConfig();
    }).toThrow(/REPEL_GMAIL_CLIENT_SECRET/);
  });
});

describe('withRedirectUri', function () {
  test('stamps the redirect URI onto the config without mutating the base', function () {
    process.env.REPEL_GMAIL_CLIENT_ID = 'id-123';
    process.env.REPEL_GMAIL_CLIENT_SECRET = 'secret-456';
    const base = loadGmailOAuthConfig();
    const config = withRedirectUri(base, 'http://127.0.0.1:5000/');
    expect(config.redirectUri).toBe('http://127.0.0.1:5000/');
    expect('redirectUri' in base).toBe(false);
  });
});
