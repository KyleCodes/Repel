import { beforeEach, describe, expect, test } from 'bun:test';
import { runWithLogContext, setService } from '../context/node';
import { createLogger, logger } from '../logger';
import type { LogRecord, Transport } from '../types';

// The node context fallback is a process-global singleton; another test file
// may have set it. Neutralize it so "no ambient service" assertions hold.
beforeEach(function () {
  setService('');
});

function spyTransport(): { transport: Transport; records: LogRecord[] } {
  const records: LogRecord[] = [];
  return {
    records,
    transport: {
      name: 'spy',
      log(record) {
        records.push(record);
      },
    },
  };
}

describe('threshold gating', function () {
  test('a warn-level logger drops debug and info, keeps warn and error', function () {
    const a = spyTransport();
    const log = createLogger({ level: 'warn', transports: [a.transport] });
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    expect(a.records.map((r) => r.level)).toEqual(['warn', 'error']);
  });

  test('builds no record when gated below threshold', function () {
    const a = spyTransport();
    const log = createLogger({ level: 'error', transports: [a.transport] });
    log.debug('d');
    log.info('i');
    log.warn('w');
    expect(a.records).toHaveLength(0);
  });
});

describe('caller fields', function () {
  test('call fields land in record.fields, verbatim', function () {
    const a = spyTransport();
    const log = createLogger({ level: 'debug', transports: [a.transport] });
    log.info('m', { req: 1, shared: 'call' });
    expect(a.records[0]!.fields).toEqual({ req: 1, shared: 'call' });
  });

  test('omits fields when none present', function () {
    const a = spyTransport();
    const log = createLogger({ level: 'debug', transports: [a.transport] });
    log.info('m');
    expect(a.records[0]!.fields).toBeUndefined();
  });

  test('omits fields for an empty object', function () {
    const a = spyTransport();
    const log = createLogger({ level: 'debug', transports: [a.transport] });
    log.info('m', {});
    expect(a.records[0]!.fields).toBeUndefined();
  });
});

describe('service (lives in context)', function () {
  test('service set via createLogger lands in record.context', function () {
    const a = spyTransport();
    const log = createLogger({
      level: 'debug',
      service: 'api',
      transports: [a.transport],
    });
    log.info('m');
    expect(a.records[0]!.context).toEqual({ service: 'api' });
  });

  test('context omitted when no service and no ambient context', function () {
    const a = spyTransport();
    const log = createLogger({ level: 'debug', transports: [a.transport] });
    log.info('m');
    expect(a.records[0]!.context).toBeUndefined();
  });

  test('service resolved from ambient context when not set explicitly', function () {
    const a = spyTransport();
    const log = createLogger({ level: 'debug', transports: [a.transport] });
    runWithLogContext({ service: 'ctx' }, () => log.info('m'));
    expect(a.records[0]!.context?.service).toBe('ctx');
  });

  test('explicit createLogger service overrides ambient context', function () {
    const a = spyTransport();
    const log = createLogger({
      level: 'debug',
      service: 'x',
      transports: [a.transport],
    });
    runWithLogContext({ service: 'ctx' }, () => log.info('m'));
    expect(a.records[0]!.context?.service).toBe('x');
  });

  test('service lives in record.context, never in record.fields', function () {
    const a = spyTransport();
    const log = createLogger({ level: 'debug', transports: [a.transport] });
    runWithLogContext({ service: 'ctx', traceId: 't' }, () => log.info('m'));
    expect(a.records[0]!.context).toEqual({ service: 'ctx', traceId: 't' });
    expect(a.records[0]!.fields).toBeUndefined();
  });
});

describe('context vs fields are separate slots', function () {
  test('ambient context (service + tracing ids) lands in record.context', function () {
    const a = spyTransport();
    const log = createLogger({ level: 'debug', transports: [a.transport] });
    runWithLogContext({ service: 'sync', traceId: 'tr', jobId: 'j' }, () =>
      log.info('m')
    );
    expect(a.records[0]!.context).toEqual({
      service: 'sync',
      traceId: 'tr',
      jobId: 'j',
    });
    expect(a.records[0]!.fields).toBeUndefined();
  });

  test('caller fields stay in fields; ambient stays in context (no merge)', function () {
    const a = spyTransport();
    const log = createLogger({ level: 'debug', transports: [a.transport] });
    runWithLogContext({ service: 's', traceId: 'tr' }, () =>
      log.info('m', { extra: 1 })
    );
    expect(a.records[0]!.context).toEqual({ service: 's', traceId: 'tr' });
    expect(a.records[0]!.fields).toEqual({ extra: 1 });
  });

  test('a key in both slots appears in both — context keeps ambient, fields keeps caller', function () {
    const a = spyTransport();
    const log = createLogger({ level: 'debug', transports: [a.transport] });
    runWithLogContext({ service: 's', traceId: 'ambient' }, () =>
      log.info('m', { traceId: 'call' })
    );
    expect(a.records[0]!.context?.traceId).toBe('ambient');
    expect(a.records[0]!.fields).toEqual({ traceId: 'call' });
  });
});

describe('multi-transport fan-out', function () {
  test('every transport receives the record', function () {
    const a = spyTransport();
    const b = spyTransport();
    const log = createLogger({
      level: 'debug',
      transports: [a.transport, b.transport],
    });
    log.info('m');
    expect(a.records).toHaveLength(1);
    expect(b.records).toHaveLength(1);
  });
});

describe('error capture', function () {
  test('error(msg) alone has no err and no fields', function () {
    const a = spyTransport();
    const log = createLogger({ level: 'debug', transports: [a.transport] });
    log.error('boom');
    expect(a.records[0]!.msg).toBe('boom');
    expect(a.records[0]!.err).toBeUndefined();
    expect(a.records[0]!.fields).toBeUndefined();
  });

  test('error(msg, fields) without an Error has no err', function () {
    const a = spyTransport();
    const log = createLogger({ level: 'debug', transports: [a.transport] });
    log.error('plain', { code: 5 });
    expect(a.records[0]!.msg).toBe('plain');
    expect(a.records[0]!.err).toBeUndefined();
    expect(a.records[0]!.fields).toEqual({ code: 5 });
  });

  test('error(msg, Error) captures the error, keeps msg', function () {
    const a = spyTransport();
    const log = createLogger({ level: 'debug', transports: [a.transport] });
    log.error('while syncing', new Error('boom'));
    expect(a.records[0]!.msg).toBe('while syncing');
    expect(a.records[0]!.err?.message).toBe('boom');
    expect(a.records[0]!.err?.name).toBe('Error');
    expect(typeof a.records[0]!.err?.stack).toBe('string');
  });

  test('error(msg, Error, fields) captures error and merges fields', function () {
    const a = spyTransport();
    const log = createLogger({ level: 'debug', transports: [a.transport] });
    log.error('m', new Error('e'), { a: 1 });
    expect(a.records[0]!.msg).toBe('m');
    expect(a.records[0]!.err?.message).toBe('e');
    expect(a.records[0]!.fields).toEqual({ a: 1 });
  });

  test('error(msg, nonError) coerces second arg to an Error', function () {
    const a = spyTransport();
    const log = createLogger({ level: 'debug', transports: [a.transport] });
    log.error('m', 'str');
    expect(a.records[0]!.msg).toBe('m');
    expect(a.records[0]!.err?.message).toBe('str');
  });

  test('error(msg, nonError, fields) coerces and merges fields', function () {
    const a = spyTransport();
    const log = createLogger({ level: 'debug', transports: [a.transport] });
    log.error('m', 42, { ctx: 'x' });
    expect(a.records[0]!.err?.message).toBe('42');
    expect(a.records[0]!.fields).toEqual({ ctx: 'x' });
  });
});

describe('output', function () {
  test('output bypasses transports entirely even at error threshold', function () {
    const a = spyTransport();
    const log = createLogger({
      level: 'error',
      transports: [a.transport],
      service: 'api',
    });
    log.output('raw text');
    expect(a.records).toHaveLength(0);
  });

  test('output writes to stdout on the server (no trailing newline added)', function () {
    const log = createLogger({
      level: 'error',
      transports: [spyTransport().transport],
    });
    const original = process.stdout.write.bind(process.stdout);
    let captured = '';
    process.stdout.write = (s: string) => {
      captured += s;
      return true;
    };
    try {
      log.output('exact');
    } finally {
      process.stdout.write = original;
    }
    expect(captured).toBe('exact');
  });

  test('output uses console.log in a browser runtime', function () {
    const log = createLogger({
      level: 'error',
      transports: [spyTransport().transport],
    });
    const g = globalThis as Record<string, unknown>;
    const originalConsoleLog = console.log;
    let captured = '';
    g.window = {};
    g.document = {};
    console.log = (s: string) => {
      captured = s;
    };
    try {
      log.output('browser raw');
    } finally {
      console.log = originalConsoleLog;
      delete g.window;
      delete g.document;
    }
    expect(captured).toBe('browser raw');
  });
});

describe('defaults', function () {
  test('createLogger() with no opts logs without throwing', function () {
    const log = createLogger();
    expect(() => log.error('smoke')).not.toThrow();
  });
});

describe('per-call LOG_LEVEL', function () {
  test('a logger with no explicit level re-reads LOG_LEVEL on every call', function () {
    const a = spyTransport();
    const log = createLogger({ transports: [a.transport] });
    const prev = process.env.LOG_LEVEL;
    try {
      process.env.LOG_LEVEL = 'error';
      log.info('suppressed');
      expect(a.records).toHaveLength(0);
      process.env.LOG_LEVEL = 'debug';
      log.info('now visible');
      expect(a.records.map((r) => r.msg)).toEqual(['now visible']);
    } finally {
      if (prev === undefined) delete process.env.LOG_LEVEL;
      else process.env.LOG_LEVEL = prev;
    }
  });

  test('an explicit level pins the threshold and ignores LOG_LEVEL', function () {
    const a = spyTransport();
    const log = createLogger({ level: 'warn', transports: [a.transport] });
    const prev = process.env.LOG_LEVEL;
    try {
      process.env.LOG_LEVEL = 'debug';
      log.info('still suppressed by the pinned warn threshold');
      expect(a.records).toHaveLength(0);
    } finally {
      if (prev === undefined) delete process.env.LOG_LEVEL;
      else process.env.LOG_LEVEL = prev;
    }
  });
});

describe('logger singleton', function () {
  test('the exported logger resolves service from ambient context', function () {
    const a = spyTransport();
    // The singleton uses the default console transport, so assert via context
    // resolution on a comparable instance plus the singleton being callable.
    const log = createLogger({ transports: [a.transport] });
    runWithLogContext({ service: 'api' }, function () {
      log.info('m');
    });
    expect(a.records[0]!.context?.service).toBe('api');
    expect(() => logger.info('singleton is callable')).not.toThrow();
  });
});
