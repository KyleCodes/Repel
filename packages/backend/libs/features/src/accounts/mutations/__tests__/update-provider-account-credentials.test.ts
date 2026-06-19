import { describe, expect, test } from 'bun:test';
import { CamelCasePlugin, Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { DB } from '@repel/backend-db/generated';
import type { Tx } from '@repel/backend-db/types';
import {
  type UpdateProviderAccountCredentialsInput,
  buildUpdateProviderAccountCredentials,
} from '../update-provider-account-credentials';

// Compile-only: build a Kysely over a never-connected Pool so .compile()
// produces SQL + parameters without any I/O. No query executes.
const db = new Kysely<DB>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: 'postgres://unused' }),
  }),
  plugins: [new CamelCasePlugin()],
});

const trx = db as unknown as Tx;

const baseInput: UpdateProviderAccountCredentialsInput = {
  providerAccount: {
    id: 'pa-1',
    credentialsEncrypted: Buffer.from('rotated', 'utf8'),
  },
};

describe('buildUpdateProviderAccountCredentials', function () {
  test('updates credentials_encrypted scoped to the row id', function () {
    const compiled = buildUpdateProviderAccountCredentials(
      trx,
      baseInput
    ).compile();
    expect(compiled.sql).toContain('credentials_encrypted');
    expect(compiled.sql).toContain('id');
    expect(compiled.parameters).toContain('pa-1');
  });

  test('does not touch any other column', function () {
    const compiled = buildUpdateProviderAccountCredentials(
      trx,
      baseInput
    ).compile();
    // Only credentials are rotated — isActive/alias/etc. stay untouched.
    expect(compiled.sql).not.toContain('is_active');
    expect(compiled.sql).not.toContain('alias');
  });

  test('returns all columns (returningAll)', function () {
    const compiled = buildUpdateProviderAccountCredentials(
      trx,
      baseInput
    ).compile();
    expect(compiled.sql.toLowerCase()).toContain('returning');
  });
});
