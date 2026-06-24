import { describe, expect, test } from 'bun:test';
import { buildDumpArgv, buildRestoreArgv } from '../dump-restore';

describe('buildDumpArgv', function () {
  test('docker compose exec pg_dump -Fc, db last, stdout-bound (no --file)', function () {
    expect(
      buildDumpArgv({ service: 'postgres', user: 'repel', database: 'repel' })
    ).toEqual([
      'compose',
      'exec',
      '-T',
      'postgres',
      'pg_dump',
      '-U',
      'repel',
      '--format=custom',
      'repel',
    ]);
  });
});

describe('buildRestoreArgv', function () {
  test('docker compose exec pg_restore clean/if-exists/no-owner into -d, stdin-bound (no file path)', function () {
    expect(
      buildRestoreArgv({
        service: 'postgres',
        user: 'repel',
        database: 'repel',
      })
    ).toEqual([
      'compose',
      'exec',
      '-T',
      'postgres',
      'pg_restore',
      '-U',
      'repel',
      '--clean',
      '--if-exists',
      '--no-owner',
      '--no-privileges',
      '-d',
      'repel',
    ]);
  });
});
