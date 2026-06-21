import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { Command } from 'commander';
import type {
  AdapterEvent,
  IProviderAdapter,
  IngestInput,
  NormalizedMessage,
} from '@repel/backend-adapters/types';
import { encrypt, loadEncryptionKey } from '@repel/backend-crypto/encryption';
import type { SyncTaskResult } from '@repel/backend-sync/handler';
import type { SyncJob } from '@repel/backend-sync/types';
import { AccountCredentialsMissingError } from '../error';
import { registerSyncCommands, runSyncRun } from '../handler';

const ENCRYPTION_KEY_HEX = randomBytes(32).toString('hex');

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const tokens = {
  accessToken: 'tok-secret',
  refreshToken: 'r-secret',
  expiresAt: 9999999999,
  tokenType: 'Bearer',
};

// A bare TokenSet is what is stored at rest (not a GmailCredentials).
function makeStoredCredentials(): Buffer {
  return encrypt(
    loadEncryptionKey(),
    Buffer.from(JSON.stringify(tokens), 'utf8')
  );
}

function makeAccount(credentialsEncrypted: Buffer | null) {
  return {
    id: 'pa-1',
    orgId: 'org-1',
    userId: 'user-9',
    provider: 'gmail',
    channel: 'email',
    authMethod: 'oauth2',
    externalAccountId: 'user@gmail.com',
    alias: 'work',
    isActive: true,
    credentialsEncrypted,
  } as never;
}

function makeNormalized(
  participants: number,
  attachments: number
): NormalizedMessage {
  return {
    externalThreadId: 't-1',
    externalMessageId: 'm-1',
    participants: Array.from({ length: participants }, function () {
      return {} as never;
    }),
    attachments: Array.from({ length: attachments }, function () {
      return {} as never;
    }),
  } as never;
}

function adapterYielding(events: readonly AdapterEvent[]): IProviderAdapter {
  return {
    capabilities: {
      channel: 'email',
      canSend: false,
      canReceive: true,
      ingressMode: 'poll',
    },
    auth: { method: 'oauth2' } as IProviderAdapter['auth'],
    ingest: async function* () {
      for (const ev of events) {
        yield ev;
      }
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
let originalKey: string | undefined;

beforeEach(function () {
  originalOrg = process.env.REPEL_ORG_ID;
  originalKey = process.env.ENCRYPTION_KEY;
  process.env.REPEL_ORG_ID = 'org-1';
  process.env.ENCRYPTION_KEY = ENCRYPTION_KEY_HEX;
});

afterEach(function () {
  if (originalOrg === undefined) delete process.env.REPEL_ORG_ID;
  else process.env.REPEL_ORG_ID = originalOrg;
  if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = originalKey;
});

describe('registerSyncCommands', function () {
  test('registers the sync namespace with a run subcommand', function () {
    const program = new Command();
    registerSyncCommands(program);
    const sync = program.commands.find(function (c) {
      return c.name() === 'sync';
    });
    expect(sync).toBeDefined();
    const subNames = sync!.commands.map(function (c) {
      return c.name();
    });
    expect(subNames).toContain('run');
  });

  test('the run command registers --full, --limit, --org, --user options', function () {
    const program = new Command();
    registerSyncCommands(program);
    const sync = program.commands.find(function (c) {
      return c.name() === 'sync';
    });
    const run = sync!.commands.find(function (c) {
      return c.name() === 'run';
    });
    const longs = run!.options.map(function (o) {
      return o.long;
    });
    expect(longs).toContain('--full');
    expect(longs).toContain('--limit');
    expect(longs).toContain('--org');
    expect(longs).toContain('--user');
  });

  test('the run command takes an account-ref positional', function () {
    const program = new Command();
    registerSyncCommands(program);
    const sync = program.commands.find(function (c) {
      return c.name() === 'sync';
    });
    const run = sync!.commands.find(function (c) {
      return c.name() === 'run';
    });
    const argNames = run!.registeredArguments.map(function (a) {
      return a.name();
    });
    expect(argNames).toContain('account-ref');
  });
});

describe('runSyncRun', function () {
  test('delegates to runSyncJob with a one-task job and writes the handler result as the summary', async function () {
    const writeSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
    let receivedJob: SyncJob | undefined;
    let printed = '';
    let writeCount = 0;
    const jobResult: readonly SyncTaskResult[] = [
      { taskId: 'unused', processed: 42, cursor: 'cur-z' },
    ];
    try {
      await runSyncRun(
        { accountRef: 'work', full: true, limit: 5 },
        {
          resolveAccount: async function () {
            return makeAccount(makeStoredCredentials());
          },
          resolveProviderAdapter: function () {
            return adapterYielding([]);
          },
          runSyncJob: async function (job: SyncJob) {
            receivedJob = job;
            return jobResult;
          },
        }
      );
      writeCount = writeSpy.mock.calls.length;
      printed = String(writeSpy.mock.calls[0]?.[0] ?? '');
    } finally {
      writeSpy.mockRestore();
    }

    expect(receivedJob).toBeDefined();
    expect(receivedJob!.tasks.length).toBe(1);
    expect(receivedJob!.tasks[0]!.providerAccountId).toBe('pa-1');
    expect(receivedJob!.tasks[0]!.spec).toEqual({ type: 'full', limit: 5 });
    expect(receivedJob!.orgId).toBe('org-1');
    expect(receivedJob!.userId).toBe('user-9');
    expect(receivedJob!.id).toMatch(UUID_RE);
    expect(receivedJob!.tasks[0]!.id).toMatch(UUID_RE);

    expect(writeCount).toBe(1);
    expect(JSON.parse(printed)).toEqual({ processed: 42, cursor: 'cur-z' });
  });

  test('passes the assembled ingest input through resolveTaskContext to the adapter', async function () {
    const writeSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
    const logSpy = spyOn(console, 'log').mockImplementation(function () {});
    let ingestInput: IngestInput | undefined;
    try {
      await runSyncRun(
        { accountRef: 'work', full: true, limit: 20 },
        {
          resolveAccount: async function () {
            return makeAccount(makeStoredCredentials());
          },
          resolveProviderAdapter: function () {
            return {
              ...adapterYielding([]),
              ingest: async function* (input: IngestInput) {
                ingestInput = input;
                yield { type: 'completed', cursor: 'c', processed: 0 };
              },
            };
          },
        }
      );
    } finally {
      writeSpy.mockRestore();
      logSpy.mockRestore();
    }
    expect(ingestInput).toEqual({
      orgId: 'org-1',
      userId: 'user-9',
      providerAccountId: 'pa-1',
      providerSlug: 'gmail',
      credentials: { provider: 'gmail', tokens },
      spec: { type: 'full', limit: 20 },
    });
  });

  test('throws AccountCredentialsMissingError and never delegates or writes when credentials are null', async function () {
    const writeSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
    let delegated = false;
    let caught: unknown;
    let writeCount = 0;
    try {
      await runSyncRun(
        { accountRef: 'work', full: true },
        {
          resolveAccount: async function () {
            return makeAccount(null);
          },
          resolveProviderAdapter: function () {
            return adapterYielding([]);
          },
          runSyncJob: async function (): Promise<readonly SyncTaskResult[]> {
            delegated = true;
            return [];
          },
        }
      );
    } catch (e) {
      caught = e;
    } finally {
      writeCount = writeSpy.mock.calls.length;
      writeSpy.mockRestore();
    }
    expect(caught).toBeInstanceOf(AccountCredentialsMissingError);
    expect(delegated).toBe(false);
    expect(writeCount).toBe(0);
  });

  test('does not leak token material when driving the real runSyncJob with an auth-refreshed stream', async function () {
    const writeSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
    const logSpy = spyOn(console, 'log').mockImplementation(function () {});
    let combined = '';
    try {
      await runSyncRun(
        { accountRef: 'work', full: true },
        {
          resolveAccount: async function () {
            return makeAccount(makeStoredCredentials());
          },
          resolveProviderAdapter: function () {
            return adapterYielding([
              {
                type: 'auth',
                refreshed: true,
                credentials: {
                  provider: 'gmail',
                  tokens: {
                    accessToken: 'tok-secret',
                    refreshToken: 'r-secret',
                    expiresAt: 1,
                    tokenType: 'Bearer',
                  },
                },
              },
              {
                type: 'message',
                raw: { externalMessageId: 'm-1' } as never,
                normalized: makeNormalized(1, 0),
                attachments: [],
              },
              { type: 'completed', cursor: 'c', processed: 1 },
            ]);
          },
        }
      );
      const printed = String(writeSpy.mock.calls[0]?.[0] ?? '');
      const logText = logSpy.mock.calls
        .map(function (c) {
          return c.map(String).join(' ');
        })
        .join('\n');
      combined = printed + '\n' + logText;
    } finally {
      writeSpy.mockRestore();
      logSpy.mockRestore();
    }
    expect(combined).not.toContain('tok-secret');
    expect(combined).not.toContain('r-secret');
    expect(combined).not.toContain('accessToken');
    expect(combined).toContain('refreshed');
  });

  test('an explicit --org wins over REPEL_ORG_ID for account resolution', async function () {
    const writeSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
    const logSpy = spyOn(console, 'log').mockImplementation(function () {});
    let ctxArg: { orgId: string } | undefined;
    try {
      await runSyncRun(
        { accountRef: 'work', full: true, org: 'org-override' },
        {
          resolveAccount: async function (_token: string, ctx) {
            ctxArg = ctx;
            return makeAccount(makeStoredCredentials());
          },
          resolveProviderAdapter: function () {
            return adapterYielding([
              { type: 'completed', cursor: 'c', processed: 0 },
            ]);
          },
        }
      );
    } finally {
      writeSpy.mockRestore();
      logSpy.mockRestore();
    }
    expect(ctxArg).toEqual({ orgId: 'org-override' });
  });

  test('decrypt receives loadEncryptionKey() and the stored ciphertext', async function () {
    const writeSpy = spyOn(process.stdout, 'write').mockReturnValue(true);
    const logSpy = spyOn(console, 'log').mockImplementation(function () {});
    const stored = makeStoredCredentials();
    const fakeKey = Buffer.from('fake-key');
    let decryptKeyArg: Buffer | undefined;
    let decryptBlobArg: Buffer | undefined;
    try {
      await runSyncRun(
        { accountRef: 'work', full: true },
        {
          resolveAccount: async function () {
            return makeAccount(stored);
          },
          loadEncryptionKey: function () {
            return fakeKey;
          },
          decrypt: function (key: Buffer, blob: Buffer) {
            decryptKeyArg = key;
            decryptBlobArg = blob;
            return Buffer.from(JSON.stringify(tokens), 'utf8');
          },
          resolveProviderAdapter: function () {
            return adapterYielding([
              { type: 'completed', cursor: 'c', processed: 0 },
            ]);
          },
        }
      );
    } finally {
      writeSpy.mockRestore();
      logSpy.mockRestore();
    }
    expect(decryptKeyArg).toBe(fakeKey);
    expect(decryptBlobArg).toBe(stored);
  });
});
