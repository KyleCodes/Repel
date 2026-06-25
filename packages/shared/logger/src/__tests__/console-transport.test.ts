import { afterEach, describe, expect, test } from 'bun:test';
import { consoleTransport } from '../transports/console';
import type { LogRecord } from '../types';

const originalFormat = process.env.LOG_FORMAT;

afterEach(function () {
  if (originalFormat === undefined) delete process.env.LOG_FORMAT;
  else process.env.LOG_FORMAT = originalFormat;
});

function record(over: Partial<LogRecord> = {}): LogRecord {
  return {
    time: '2026-06-24T00:00:00.000Z',
    level: 'error',
    context: { service: 'sync' },
    msg: 'boom',
    ...over,
  };
}

const serverRuntime = { isBrowser: () => false, isTTY: () => false };

describe('consoleTransport pretty', function () {
  test('forced pretty contains ANSI red, [ERROR], and service', function () {
    let out = '';
    const t = consoleTransport({
      format: 'pretty',
      write: (s) => {
        out += s;
      },
      runtime: serverRuntime,
    });
    t.log(record());
    expect(out).toContain('\x1b[31m');
    expect(out).toContain('[ERROR]');
    expect(out).toContain('sync');
  });
});

describe('consoleTransport json', function () {
  test('forced json is a single JSON line ending in newline', function () {
    let out = '';
    const t = consoleTransport({
      format: 'json',
      write: (s) => {
        out += s;
      },
      runtime: serverRuntime,
    });
    t.log(record({ level: 'info', msg: 'hi' }));
    expect(out.endsWith('\n')).toBe(true);
    expect(out.indexOf('\n')).toBe(out.length - 1);
    const parsed = JSON.parse(out) as LogRecord;
    expect(parsed.msg).toBe('hi');
  });
});

describe('consoleTransport browser branch', function () {
  test('calls browserConsole[level] with an ANSI-free string', function () {
    const calls: { level: string; arg: string }[] = [];
    const browserConsole = {
      debug: (s: string) => calls.push({ level: 'debug', arg: s }),
      info: (s: string) => calls.push({ level: 'info', arg: s }),
      warn: (s: string) => calls.push({ level: 'warn', arg: s }),
      error: (s: string) => calls.push({ level: 'error', arg: s }),
    };
    const t = consoleTransport({
      browserConsole,
      runtime: { isBrowser: () => true, isTTY: () => false },
    });
    t.log(record({ fields: { a: 1 } }));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.level).toBe('error');
    expect(calls[0]!.arg).not.toContain('\x1b');
    expect(calls[0]!.arg).toContain('boom');
    expect(calls[0]!.arg).toContain('[ERROR]');
    expect(calls[0]!.arg).toContain('sync');
    // One envelope object, fields before context.
    const json = calls[0]!.arg.slice(calls[0]!.arg.indexOf('{'));
    expect(JSON.parse(json)).toEqual({
      fields: { a: 1 },
      context: { service: 'sync' },
    });
  });

  test('browser string appends error stack when err present', function () {
    const calls: string[] = [];
    const browserConsole = {
      debug: (s: string) => calls.push(s),
      info: (s: string) => calls.push(s),
      warn: (s: string) => calls.push(s),
      error: (s: string) => calls.push(s),
    };
    const t = consoleTransport({
      browserConsole,
      runtime: { isBrowser: () => true, isTTY: () => false },
    });
    t.log(
      record({
        err: {
          name: 'Error',
          message: 'kaboom',
          stack: 'Error: kaboom\n at y',
        },
      })
    );
    expect(calls[0]).toContain('kaboom');
    expect(calls[0]).not.toContain('\x1b');
  });

  test('browser string omits service segment when empty', function () {
    const calls: string[] = [];
    const browserConsole = {
      debug: (s: string) => calls.push(s),
      info: (s: string) => calls.push(s),
      warn: (s: string) => calls.push(s),
      error: (s: string) => calls.push(s),
    };
    const t = consoleTransport({
      browserConsole,
      runtime: { isBrowser: () => true, isTTY: () => false },
    });
    t.log(record({ level: 'info', context: undefined, msg: 'plain' }));
    expect(calls[0]).toContain('plain');
    expect(calls[0]).not.toContain('sync: ');
    expect(calls[0]).not.toContain('\x1b');
  });
});

describe('consoleTransport format resolution', function () {
  test('LOG_FORMAT override is respected over auto-detect', function () {
    process.env.LOG_FORMAT = 'json';
    let out = '';
    const t = consoleTransport({
      write: (s) => {
        out += s;
      },
      runtime: { isBrowser: () => false, isTTY: () => true },
    });
    t.log(record({ level: 'info' }));
    expect(() => JSON.parse(out)).not.toThrow();
  });

  test('auto-detect picks json when stderr is not a TTY', function () {
    delete process.env.LOG_FORMAT;
    let out = '';
    const t = consoleTransport({
      write: (s) => {
        out += s;
      },
      runtime: { isBrowser: () => false, isTTY: () => false },
    });
    t.log(record({ level: 'info' }));
    expect(() => JSON.parse(out)).not.toThrow();
  });

  test('auto-detect picks pretty when stderr is a TTY', function () {
    delete process.env.LOG_FORMAT;
    let out = '';
    const t = consoleTransport({
      write: (s) => {
        out += s;
      },
      runtime: { isBrowser: () => false, isTTY: () => true },
    });
    t.log(record({ level: 'info' }));
    expect(() => JSON.parse(out)).toThrow();
    expect(out).toContain('[INFO]');
  });
});

describe('consoleTransport metadata', function () {
  test('exposes a name', function () {
    const t = consoleTransport({ runtime: serverRuntime });
    expect(t.name).toBe('console');
  });
});

describe('consoleTransport routes every level to stderr', function () {
  test('debug, info, warn, and error all write via the single seam', function () {
    const seen: string[] = [];
    const t = consoleTransport({
      format: 'json',
      write: (s) => {
        const parsed = JSON.parse(s) as LogRecord;
        seen.push(parsed.level);
      },
      runtime: serverRuntime,
    });
    t.log(record({ level: 'debug', msg: 'd' }));
    t.log(record({ level: 'info', msg: 'i' }));
    t.log(record({ level: 'warn', msg: 'w' }));
    t.log(record({ level: 'error', msg: 'e' }));
    expect(seen).toEqual(['debug', 'info', 'warn', 'error']);
  });
});

describe('consoleTransport default seams', function () {
  test('default write sends every level to process.stderr', function () {
    const originalErr = process.stderr.write.bind(process.stderr);
    const originalOut = process.stdout.write.bind(process.stdout);
    let errCaptured = '';
    let outCaptured = '';
    process.stderr.write = (s: string) => {
      errCaptured += s;
      return true;
    };
    process.stdout.write = (s: string) => {
      outCaptured += s;
      return true;
    };
    try {
      const t = consoleTransport({ format: 'json', runtime: serverRuntime });
      t.log(record({ level: 'info', msg: 'viaerr-info' }));
      t.log(record({ level: 'error', msg: 'viaerr-error' }));
    } finally {
      process.stderr.write = originalErr;
      process.stdout.write = originalOut;
    }
    expect(errCaptured).toContain('viaerr-info');
    expect(errCaptured).toContain('viaerr-error');
    expect(outCaptured).toBe('');
  });

  test('default browserConsole is the global console', function () {
    const originalError = console.error;
    let captured = '';
    console.error = (s: string) => {
      captured = s;
    };
    try {
      const t = consoleTransport({
        runtime: { isBrowser: () => true, isTTY: () => false },
      });
      t.log(record({ msg: 'viaconsole' }));
    } finally {
      console.error = originalError;
    }
    expect(captured).toContain('viaconsole');
    expect(captured).not.toContain('\x1b');
  });
});
