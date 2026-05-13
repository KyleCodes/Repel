import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';

// Guards against the legacy migrate:* scripts coming back. The repel db
// migrate command is now the canonical entrypoint.
describe('root package.json migrate:* scripts', function () {
  const pkgPath = join(import.meta.dir, '../../../../../../../package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
    scripts?: Record<string, string>;
  };

  test('migrate:create is absent', function () {
    expect(pkg.scripts?.['migrate:create']).toBeUndefined();
  });
  test('migrate:up is absent', function () {
    expect(pkg.scripts?.['migrate:up']).toBeUndefined();
  });
  test('migrate:down is absent', function () {
    expect(pkg.scripts?.['migrate:down']).toBeUndefined();
  });
});
