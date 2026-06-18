import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { Command } from 'commander';
import { ProviderNotFoundError } from '@repel/backend-adapters/error';
import { OAuth2TimeoutError } from '@repel/backend-adapters/lib/oauth2/error';
import { OAuth2DeniedError } from '@repel/backend-adapters/lib/oauth2/error';
import type {
  IProviderAdapter,
  ProviderAuthorization,
} from '@repel/backend-adapters/types';
import {
  decrypt,
  encrypt,
  loadEncryptionKey,
} from '@repel/backend-crypto/encryption';
import { DuplicateProviderAccountError } from '@repel/backend-features/accounts/error';
import * as resolveAccountModule from '../../lib/resolve-account.ts';
import {
  AccountIdentityMismatchError,
  UnsupportedAuthMethodError,
} from '../error.ts';
import {
  registerAccountsCommands,
  runAccountsConnect,
  runAccountsReconnect,
  runAccountsShow,
} from '../handler.ts';

const ENCRYPTION_KEY_HEX = randomBytes(32).toString('hex');

describe('registerAccountsCommands', function () {
  test('registers the accounts namespace with list|show|rm|connect|reconnect', function () {
    const program = new Command();
    registerAccountsCommands(program);
    const accounts = program.commands.find(function (c) {
      return c.name() === 'accounts';
    });
    expect(accounts).toBeDefined();
    const subNames = accounts!.commands.map(function (c) {
      return c.name();
    });
    expect(subNames).toContain('list');
    expect(subNames).toContain('show');
    expect(subNames).toContain('rm');
    expect(subNames).toContain('connect');
    expect(subNames).toContain('reconnect');
  });

  test('no longer registers the old add verb', function () {
    const program = new Command();
    registerAccountsCommands(program);
    const accounts = program.commands.find(function (c) {
      return c.name() === 'accounts';
    });
    const subNames = accounts!.commands.map(function (c) {
      return c.name();
    });
    expect(subNames).not.toContain('add');
  });

  test('no longer registers bootstrap — it moved to the orgs namespace', function () {
    const program = new Command();
    registerAccountsCommands(program);
    const accounts = program.commands.find(function (c) {
      return c.name() === 'accounts';
    });
    const subNames = accounts!.commands.map(function (c) {
      return c.name();
    });
    expect(subNames).not.toContain('bootstrap');
  });

  test('the connect command registers a --alias option', function () {
    const program = new Command();
    registerAccountsCommands(program);
    const accounts = program.commands.find(function (c) {
      return c.name() === 'accounts';
    });
    const connect = accounts!.commands.find(function (c) {
      return c.name() === 'connect';
    });
    const optionNames = connect!.options.map(function (o) {
      return o.long;
    });
    expect(optionNames).toContain('--alias');
  });
});

// runAccountsConnect: deps are injected so no real browser/network/db is
// touched. REPEL_ORG_ID / REPEL_USER_ID are set so resolveOrgId/resolveUserId
// succeed.

const credentials = { accessToken: 'tok-abc', refreshToken: 'r' };

const authorization: ProviderAuthorization = {
  externalAccountId: 'user@gmail.com',
  authMethod: 'oauth2',
  credentials,
};

function makeAdapter(authMethod = 'oauth2'): IProviderAdapter {
  return {
    capabilities: {
      channel: 'email',
      canSend: false,
      canReceive: true,
      ingressMode: 'poll',
    },
    auth: { method: authMethod as 'oauth2' } as IProviderAdapter['auth'],
    ingest: function () {
      throw new Error('unused');
    },
    send: async function () {
      throw new Error('unused');
    },
    normalize: function () {
      throw new Error('unused');
    },
  };
}

let originalOrg: string | undefined;
let originalUser: string | undefined;
let originalKey: string | undefined;

beforeEach(function () {
  originalOrg = process.env.REPEL_ORG_ID;
  originalUser = process.env.REPEL_USER_ID;
  originalKey = process.env.ENCRYPTION_KEY;
  process.env.REPEL_ORG_ID = 'org-1';
  process.env.REPEL_USER_ID = 'user-1';
  process.env.ENCRYPTION_KEY = ENCRYPTION_KEY_HEX;
});

afterEach(function () {
  if (originalOrg === undefined) delete process.env.REPEL_ORG_ID;
  else process.env.REPEL_ORG_ID = originalOrg;
  if (originalUser === undefined) delete process.env.REPEL_USER_ID;
  else process.env.REPEL_USER_ID = originalUser;
  if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = originalKey;
});

describe('runAccountsConnect', function () {
  test('happy path inserts the account and prints only safe identifiers', async function () {
    const writeSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
    let addCallCount = 0;
    let addArg: Record<string, unknown> | undefined;
    let printed = '';

    try {
      await runAccountsConnect(
        { provider: 'gmail', alias: 'work' },
        {
          resolveProviderAdapter: function () {
            return makeAdapter();
          },
          runLoopbackFlow: async function () {
            return authorization;
          },
          accountsService: {
            addProviderAccount: async function (arg) {
              addCallCount += 1;
              addArg = arg;
              return {
                id: 'pa-1',
                alias: 'work',
                externalAccountId: 'user@gmail.com',
              } as never;
            },
          },
        }
      );
      // Capture before mockRestore — bun clears mock.calls on restore.
      printed = String(writeSpy.mock.calls[0][0]);
    } finally {
      writeSpy.mockRestore();
    }

    expect(addCallCount).toBe(1);
    expect(addArg).toMatchObject({
      orgId: 'org-1',
      providerAccount: {
        orgId: 'org-1',
        userId: 'user-1',
        provider: 'gmail',
        channel: 'email',
        authMethod: 'oauth2',
        externalAccountId: 'user@gmail.com',
        alias: 'work',
      },
    });
    const written = (addArg!.providerAccount as Record<string, unknown>)
      .credentialsEncrypted as Buffer;
    expect(Buffer.isBuffer(written)).toBe(true);
    // The stored bytes are ciphertext — not the plaintext JSON.
    expect(written.toString('utf8')).not.toContain('tok-abc');
    expect(written.toString('utf8')).not.toContain('accessToken');
    // …but decrypt round-trips back to the original credentials JSON.
    const decoded = JSON.parse(
      decrypt(loadEncryptionKey(), written).toString('utf8')
    );
    expect(decoded).toEqual(credentials);

    expect(JSON.parse(printed)).toEqual({
      id: 'pa-1',
      alias: 'work',
      externalAccountId: 'user@gmail.com',
    });
    // No credential material leaks to stdout.
    expect(printed).not.toContain('tok-abc');
    expect(printed).not.toContain('accessToken');
  });

  test('does not insert and prints nothing when OAuth times out', async function () {
    const writeSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
    let addCalled = false;
    let caught: unknown;
    try {
      await runAccountsConnect(
        { provider: 'gmail' },
        {
          resolveProviderAdapter: function () {
            return makeAdapter();
          },
          runLoopbackFlow: async function () {
            throw new OAuth2TimeoutError('timed out');
          },
          accountsService: {
            addProviderAccount: async function () {
              addCalled = true;
              return {} as never;
            },
          },
        }
      );
    } catch (e) {
      caught = e;
    } finally {
      writeSpy.mockRestore();
    }
    expect(caught).toBeInstanceOf(OAuth2TimeoutError);
    expect(addCalled).toBe(false);
    expect(writeSpy).not.toHaveBeenCalled();
  });

  test('does not insert when OAuth is denied', async function () {
    const writeSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
    let addCalled = false;
    let caught: unknown;
    try {
      await runAccountsConnect(
        { provider: 'gmail' },
        {
          resolveProviderAdapter: function () {
            return makeAdapter();
          },
          runLoopbackFlow: async function () {
            throw new OAuth2DeniedError('denied');
          },
          accountsService: {
            addProviderAccount: async function () {
              addCalled = true;
              return {} as never;
            },
          },
        }
      );
    } catch (e) {
      caught = e;
    } finally {
      writeSpy.mockRestore();
    }
    expect(caught).toBeInstanceOf(OAuth2DeniedError);
    expect(addCalled).toBe(false);
  });

  test('does not run OAuth or insert when the provider has no adapter', async function () {
    const writeSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
    let loopbackCalled = false;
    let addCalled = false;
    let caught: unknown;
    try {
      await runAccountsConnect(
        { provider: 'icloud' },
        {
          resolveProviderAdapter: function () {
            throw new ProviderNotFoundError('no adapter for icloud');
          },
          runLoopbackFlow: async function () {
            loopbackCalled = true;
            return authorization;
          },
          accountsService: {
            addProviderAccount: async function () {
              addCalled = true;
              return {} as never;
            },
          },
        }
      );
    } catch (e) {
      caught = e;
    } finally {
      writeSpy.mockRestore();
    }
    expect(caught).toBeInstanceOf(ProviderNotFoundError);
    expect(loopbackCalled).toBe(false);
    expect(addCalled).toBe(false);
  });

  test('errors clearly and skips OAuth when the adapter is not oauth2', async function () {
    const writeSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
    let loopbackCalled = false;
    let caught: unknown;
    try {
      await runAccountsConnect(
        { provider: 'gmail' },
        {
          resolveProviderAdapter: function () {
            return makeAdapter('app_password');
          },
          runLoopbackFlow: async function () {
            loopbackCalled = true;
            return authorization;
          },
          accountsService: {
            addProviderAccount: async function () {
              return {} as never;
            },
          },
        }
      );
    } catch (e) {
      caught = e;
    } finally {
      writeSpy.mockRestore();
    }
    expect(caught).toBeInstanceOf(UnsupportedAuthMethodError);
    expect((caught as Error).message).toContain('oauth2');
    expect(loopbackCalled).toBe(false);
  });

  test('surfaces DuplicateProviderAccountError and prints nothing', async function () {
    const writeSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
    let caught: unknown;
    try {
      await runAccountsConnect(
        { provider: 'gmail' },
        {
          resolveProviderAdapter: function () {
            return makeAdapter();
          },
          runLoopbackFlow: async function () {
            return authorization;
          },
          accountsService: {
            addProviderAccount: async function () {
              throw new DuplicateProviderAccountError('dupe');
            },
          },
        }
      );
    } catch (e) {
      caught = e;
    } finally {
      writeSpy.mockRestore();
    }
    expect(caught).toBeInstanceOf(DuplicateProviderAccountError);
    expect(writeSpy).not.toHaveBeenCalled();
  });

  test('flows the alias through to addProviderAccount', async function () {
    const writeSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
    let addArg: Record<string, unknown> | undefined;
    try {
      await runAccountsConnect(
        { provider: 'gmail', alias: 'personal' },
        {
          resolveProviderAdapter: function () {
            return makeAdapter();
          },
          runLoopbackFlow: async function () {
            return authorization;
          },
          accountsService: {
            addProviderAccount: async function (arg) {
              addArg = arg;
              return {
                id: 'pa-2',
                alias: 'personal',
                externalAccountId: 'user@gmail.com',
              } as never;
            },
          },
        }
      );
    } finally {
      writeSpy.mockRestore();
    }
    expect((addArg!.providerAccount as Record<string, unknown>).alias).toBe(
      'personal'
    );
  });
});

// runAccountsReconnect: deps are injected (incl. resolveAccount), so no real
// browser/network/db is touched. The resolved account is the existing row;
// reconnect re-runs OAuth, guards identity, and rotates credentials in place.

function makeResolvedAccount(externalAccountId = 'user@gmail.com') {
  return {
    id: 'pa-1',
    orgId: 'org-1',
    userId: 'user-1',
    provider: 'gmail',
    channel: 'email',
    authMethod: 'oauth2',
    externalAccountId,
    alias: 'work',
    isActive: true,
    credentialsEncrypted: null,
  } as never;
}

describe('runAccountsReconnect', function () {
  test('rotates credentials in place and prints only safe identifiers', async function () {
    const writeSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
    let updateArg: Record<string, unknown> | undefined;
    let printed = '';
    try {
      await runAccountsReconnect(
        { account: 'work' },
        {
          resolveAccount: async function () {
            return makeResolvedAccount();
          },
          resolveProviderAdapter: function () {
            return makeAdapter();
          },
          runLoopbackFlow: async function () {
            return authorization;
          },
          accountsService: {
            updateProviderAccountCredentials: async function (arg) {
              updateArg = arg;
              return {
                id: 'pa-1',
                alias: 'work',
                externalAccountId: 'user@gmail.com',
              } as never;
            },
          },
        }
      );
      printed = String(writeSpy.mock.calls[0][0]);
    } finally {
      writeSpy.mockRestore();
    }

    // Updates the existing row by id — no new id minted.
    expect(updateArg).toMatchObject({
      orgId: 'org-1',
      providerAccount: { id: 'pa-1' },
    });
    const written = (updateArg!.providerAccount as Record<string, unknown>)
      .credentialsEncrypted as Buffer;
    expect(Buffer.isBuffer(written)).toBe(true);
    // Stored bytes are ciphertext, but decrypt round-trips to the new creds.
    expect(written.toString('utf8')).not.toContain('tok-abc');
    const decoded = JSON.parse(
      decrypt(loadEncryptionKey(), written).toString('utf8')
    );
    expect(decoded).toEqual(credentials);

    expect(JSON.parse(printed)).toEqual({
      id: 'pa-1',
      alias: 'work',
      externalAccountId: 'user@gmail.com',
    });
    expect(printed).not.toContain('tok-abc');
  });

  test('rejects and writes nothing when OAuth returns a different external account', async function () {
    const writeSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
    let updateCalled = false;
    let caught: unknown;
    try {
      await runAccountsReconnect(
        { account: 'work' },
        {
          resolveAccount: async function () {
            return makeResolvedAccount('original@gmail.com');
          },
          resolveProviderAdapter: function () {
            return makeAdapter();
          },
          runLoopbackFlow: async function () {
            // authorization.externalAccountId is 'user@gmail.com' — a mismatch.
            return authorization;
          },
          accountsService: {
            updateProviderAccountCredentials: async function () {
              updateCalled = true;
              return {} as never;
            },
          },
        }
      );
    } catch (e) {
      caught = e;
    } finally {
      writeSpy.mockRestore();
    }
    expect(caught).toBeInstanceOf(AccountIdentityMismatchError);
    expect(updateCalled).toBe(false);
    expect(writeSpy).not.toHaveBeenCalled();
  });

  test('does not run OAuth or update when OAuth times out', async function () {
    const writeSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
    let updateCalled = false;
    let caught: unknown;
    try {
      await runAccountsReconnect(
        { account: 'work' },
        {
          resolveAccount: async function () {
            return makeResolvedAccount();
          },
          resolveProviderAdapter: function () {
            return makeAdapter();
          },
          runLoopbackFlow: async function () {
            throw new OAuth2TimeoutError('timed out');
          },
          accountsService: {
            updateProviderAccountCredentials: async function () {
              updateCalled = true;
              return {} as never;
            },
          },
        }
      );
    } catch (e) {
      caught = e;
    } finally {
      writeSpy.mockRestore();
    }
    expect(caught).toBeInstanceOf(OAuth2TimeoutError);
    expect(updateCalled).toBe(false);
    expect(writeSpy).not.toHaveBeenCalled();
  });

  test('errors and skips OAuth when the resolved account is not oauth2', async function () {
    const writeSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
    let loopbackCalled = false;
    let caught: unknown;
    try {
      await runAccountsReconnect(
        { account: 'work' },
        {
          resolveAccount: async function () {
            return makeResolvedAccount();
          },
          resolveProviderAdapter: function () {
            return makeAdapter('app_password');
          },
          runLoopbackFlow: async function () {
            loopbackCalled = true;
            return authorization;
          },
          accountsService: {
            updateProviderAccountCredentials: async function () {
              return {} as never;
            },
          },
        }
      );
    } catch (e) {
      caught = e;
    } finally {
      writeSpy.mockRestore();
    }
    expect(caught).toBeInstanceOf(UnsupportedAuthMethodError);
    expect(loopbackCalled).toBe(false);
  });
});

// runAccountsShow: resolveAccount is module-imported; spyOn replaces the export
// so no DB is touched. ENCRYPTION_KEY is set in beforeEach, so the stored
// ciphertext (built here with the real encrypt) decrypts back for display.

function makeStoredAccount(credentialsEncrypted: Buffer | null) {
  return {
    id: 'pa-1',
    orgId: 'org-1',
    userId: 'user-1',
    provider: 'gmail',
    channel: 'email',
    authMethod: 'oauth2',
    externalAccountId: 'user@gmail.com',
    alias: 'work',
    isActive: true,
    credentialsEncrypted,
  } as never;
}

describe('runAccountsShow', function () {
  test('decrypts credentials for display and drops the raw bytes', async function () {
    const stored = encrypt(
      loadEncryptionKey(),
      Buffer.from(JSON.stringify(credentials), 'utf8')
    );
    const resolveSpy = spyOn(
      resolveAccountModule,
      'resolveAccount'
    ).mockResolvedValue(makeStoredAccount(stored));
    const writeSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
    let printed = '';
    try {
      await runAccountsShow({ account: 'pa-1' });
      printed = String(writeSpy.mock.calls[0][0]);
    } finally {
      writeSpy.mockRestore();
      resolveSpy.mockRestore();
    }
    const out = JSON.parse(printed);
    expect(out.credentials).toEqual(credentials);
    // The raw ciphertext field is gone from the output.
    expect(out).not.toHaveProperty('credentialsEncrypted');
    expect(out.id).toBe('pa-1');
  });

  test('shows credentials: null when the row has no stored credentials', async function () {
    const resolveSpy = spyOn(
      resolveAccountModule,
      'resolveAccount'
    ).mockResolvedValue(makeStoredAccount(null));
    const writeSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
    let printed = '';
    try {
      await runAccountsShow({ account: 'pa-1' });
      printed = String(writeSpy.mock.calls[0][0]);
    } finally {
      writeSpy.mockRestore();
      resolveSpy.mockRestore();
    }
    const out = JSON.parse(printed);
    expect(out.credentials).toBeNull();
    expect(out).not.toHaveProperty('credentialsEncrypted');
  });
});
