import { describe, expect, test } from 'bun:test';
import { resolveService, serviceNames } from '../registry';

describe('service registry', function () {
  test('registers api and sync-worker', function () {
    expect(serviceNames()).toContain('api');
    expect(serviceNames()).toContain('sync-worker');
  });

  test('resolveService returns a loader for a registered name', function () {
    expect(typeof resolveService('api')).toBe('function');
    expect(typeof resolveService('sync-worker')).toBe('function');
  });

  test('resolveService returns undefined for an unknown name', function () {
    expect(resolveService('nope')).toBeUndefined();
  });

  test('the api loader resolves to a RunnableApp with start()', async function () {
    const load = resolveService('api')!;
    const app = await load();
    expect(typeof app.start).toBe('function');
  });

  test('the sync-worker loader resolves to a RunnableApp with start() and stop()', async function () {
    const load = resolveService('sync-worker')!;
    const app = await load();
    expect(typeof app.start).toBe('function');
    // sync-worker is the first app to implement the optional stop() (drain).
    expect(typeof app.stop).toBe('function');
  });
});
