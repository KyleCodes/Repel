import { describe, expect, test } from 'bun:test';
import { resolveService, serviceNames } from '../registry';

describe('service registry', function () {
  test('registers api', function () {
    expect(serviceNames()).toContain('api');
  });

  test('resolveService returns a loader for a registered name', function () {
    expect(typeof resolveService('api')).toBe('function');
  });

  test('resolveService returns undefined for an unknown name', function () {
    expect(resolveService('nope')).toBeUndefined();
  });

  test('the api loader resolves to a RunnableApp with start()', async function () {
    const load = resolveService('api')!;
    const app = await load();
    expect(typeof app.start).toBe('function');
  });
});
