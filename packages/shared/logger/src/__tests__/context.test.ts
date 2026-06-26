import { describe, expect, test } from 'bun:test';
import * as browser from '../context/browser';
import * as node from '../context/node';

describe('context.node', function () {
  test('currentLogContext/currentService are undefined outside any run', function () {
    expect(node.currentLogContext()).toBeUndefined();
    expect(node.currentService()).toBeUndefined();
  });

  test('runWithLogContext exposes the fields inside fn', function () {
    const seen = node.runWithLogContext(
      { service: 'api', traceId: 't1' },
      () => ({
        ctx: node.currentLogContext(),
        svc: node.currentService(),
      })
    );
    expect(seen.ctx).toEqual({ service: 'api', traceId: 't1' });
    expect(seen.svc).toBe('api');
  });

  test('returns fn return value verbatim', function () {
    const value = node.runWithLogContext({ service: 'a' }, () => 42);
    expect(value).toBe(42);
  });

  test('flatten-merges nested runs, inner wins on collision', function () {
    const result = node.runWithLogContext(
      { service: 'outer', traceId: 't' },
      () =>
        node.runWithLogContext({ jobId: 'j', traceId: 'inner' }, () =>
          node.currentLogContext()
        )
    );
    expect(result).toEqual({
      service: 'outer',
      traceId: 'inner',
      jobId: 'j',
    });
  });

  test('restores parent context after a nested run returns', function () {
    node.runWithLogContext({ service: 'outer', traceId: 't' }, () => {
      node.runWithLogContext({ jobId: 'j' }, () => undefined);
      expect(node.currentLogContext()).toEqual({
        service: 'outer',
        traceId: 't',
      });
    });
  });

  test('propagates across await inside fn', async function () {
    const traceId = await node.runWithLogContext(
      { service: 'api', traceId: 'tx' },
      async () => {
        await Promise.resolve();
        return node.currentLogContext()?.traceId;
      }
    );
    expect(traceId).toBe('tx');
  });

  test('sibling runs are isolated from each other', function () {
    const a = node.runWithLogContext({ service: 'a' }, () =>
      node.currentService()
    );
    const b = node.runWithLogContext({ service: 'b' }, () =>
      node.currentService()
    );
    expect(a).toBe('a');
    expect(b).toBe('b');
    expect(node.currentLogContext()).toBeUndefined();
  });

  test('setService fallback is used only when no store is active', function () {
    node.setService('boot');
    expect(node.currentService()).toBe('boot');
    expect(node.currentLogContext()).toEqual({ service: 'boot' });
  });

  test('runWithLogContext overrides the setService fallback within fn', function () {
    node.setService('boot');
    const inside = node.runWithLogContext({ service: 'req' }, () =>
      node.currentService()
    );
    expect(inside).toBe('req');
    expect(node.currentService()).toBe('boot');
  });
});

describe('context.browser', function () {
  test('currentLogContext is undefined at module load', function () {
    // runs first in file order; no browser state has been set yet.
    expect(browser.currentLogContext()).toBeUndefined();
    expect(browser.currentService()).toBeUndefined();
  });

  test('runWithLogContext restores prior context after fn returns', function () {
    const prior = browser.currentLogContext();
    browser.runWithLogContext({ service: 'x' }, () => undefined);
    expect(browser.currentLogContext()).toEqual(prior);
  });

  test('setService then currentService returns the set value', function () {
    browser.setService('web');
    expect(browser.currentService()).toBe('web');
    expect(browser.currentLogContext()).toEqual({ service: 'web' });
  });

  test('setService merges over existing context', function () {
    browser.setService('web');
    browser.setService('web2');
    expect(browser.currentLogContext()).toEqual({ service: 'web2' });
  });

  test('setService("") clears the service (context omitted, not service:"")', function () {
    browser.setService('web');
    browser.setService('');
    expect(browser.currentLogContext()).toBeUndefined();
    expect(browser.currentService()).toBeUndefined();
  });

  test('setService("") on a never-set service is a safe no-op', function () {
    browser.setService('');
    expect(browser.currentLogContext()).toBeUndefined();
  });

  test('runWithLogContext sets context for fn extent and restores after', function () {
    browser.setService('web');
    const inside = browser.runWithLogContext({ traceId: 't' }, () =>
      browser.currentLogContext()
    );
    expect(inside).toEqual({ service: 'web', traceId: 't' });
    expect(browser.currentLogContext()).toEqual({ service: 'web' });
  });

  test('flatten-merges nested runs, inner wins on collision', function () {
    const result = browser.runWithLogContext(
      { service: 'outer', traceId: 't' },
      () =>
        browser.runWithLogContext({ jobId: 'j', traceId: 'inner' }, () =>
          browser.currentLogContext()
        )
    );
    expect(result).toEqual({
      service: 'outer',
      traceId: 'inner',
      jobId: 'j',
    });
  });

  test('returns fn return value verbatim', function () {
    expect(browser.runWithLogContext({}, () => 7)).toBe(7);
  });

  test('currentService reads from currentLogContext', function () {
    browser.runWithLogContext({ service: 's' }, () => {
      expect(browser.currentService()).toBe('s');
    });
  });
});
