import { describe, expect, test } from 'bun:test';
import { CamelCasePlugin, Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { DB } from '@repel/backend-db/generated';
import type { Tx } from '@repel/backend-db/types';
import {
  type AddProviderAccountInput,
  buildAddProviderAccount,
} from '../add-provider-account.ts';

// Compile-only: build a Kysely over a never-connected Pool (mirrors
// infra/db/client.ts config) so .compile() produces SQL + parameters without
// any I/O. No query executes.
const db = new Kysely<DB>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: 'postgres://unused' }),
  }),
  plugins: [new CamelCasePlugin()],
});

// The build fn takes a Tx; the unconnected Kysely instance is structurally fine
// for .compile(), which never touches the connection.
const trx = db as unknown as Tx;

const baseInput: AddProviderAccountInput = {
  providerAccount: {
    orgId: 'org-1',
    userId: 'user-1',
    provider: 'gmail',
    channel: 'email',
    authMethod: 'oauth2',
    externalAccountId: 'user@gmail.com',
    credentialsEncrypted: Buffer.from('creds', 'utf8'),
  },
};

describe('buildAddProviderAccount', function () {
  test('writes org_id explicitly (RLS requires it on INSERT)', function () {
    const compiled = buildAddProviderAccount(trx, baseInput).compile();
    expect(compiled.sql).toContain('org_id');
    expect(compiled.parameters).toContain('org-1');
  });

  test('includes every required column', function () {
    const compiled = buildAddProviderAccount(trx, baseInput).compile();
    for (const col of [
      'org_id',
      'user_id',
      'provider',
      'channel',
      'auth_method',
      'external_account_id',
      'credentials_encrypted',
    ]) {
      expect(compiled.sql).toContain(col);
    }
  });

  test('returns all columns (returningAll)', function () {
    const compiled = buildAddProviderAccount(trx, baseInput).compile();
    expect(compiled.sql.toLowerCase()).toContain('returning');
  });

  test('alias column is omitted when not provided (defaults to NULL)', function () {
    // input passes straight to .values(); an undefined alias is dropped by
    // Kysely, so the column is absent from the INSERT and the row gets NULL.
    const compiled = buildAddProviderAccount(trx, baseInput).compile();
    expect(compiled.sql).not.toContain('alias');
  });

  test('alias is included as a bound parameter when set', function () {
    const compiled = buildAddProviderAccount(trx, {
      providerAccount: { ...baseInput.providerAccount, alias: 'work' },
    }).compile();
    expect(compiled.sql).toContain('alias');
    expect(compiled.parameters).toContain('work');
  });
});
