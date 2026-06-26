import { describe, expect, test } from 'bun:test';
import { formatJsonLine, formatPretty } from '../format';
import type { LogRecord } from '../types';

function baseRecord(over: Partial<LogRecord> = {}): LogRecord {
  return {
    time: '2026-06-24T00:00:00.000Z',
    level: 'info',
    context: { service: 'sync' },
    msg: 'hello',
    ...over,
  };
}

describe('formatPretty', function () {
  test('includes time, uppercased level tag, service, and msg', function () {
    const line = formatPretty(baseRecord());
    expect(line).toContain('2026-06-24T00:00:00.000Z');
    expect(line).toContain('[INFO]');
    expect(line).toContain('sync');
    expect(line).toContain('hello');
    expect(line.endsWith('\n')).toBe(true);
  });

  test('omits service prefix when there is no context', function () {
    const line = formatPretty(baseRecord({ context: undefined }));
    expect(line).toContain('hello');
    expect(line).not.toContain('sync: ');
  });

  test('emits one envelope object with fields then context', function () {
    const line = formatPretty(
      baseRecord({
        context: { service: 'sync', traceId: 't' },
        fields: { userId: 7 },
      })
    );
    // The trailing token is a single JSON object (not two blobs).
    const json = line.trimEnd().slice(line.trimEnd().indexOf('{'));
    const parsed = JSON.parse(json) as {
      fields: Record<string, unknown>;
      context: Record<string, unknown>;
    };
    expect(parsed).toEqual({
      fields: { userId: 7 },
      context: { service: 'sync', traceId: 't' },
    });
    // fields is rendered before context.
    expect(json.indexOf('"fields"')).toBeLessThan(json.indexOf('"context"'));
  });

  test('envelope always carries both keys, empty when a slot is absent', function () {
    const line = formatPretty(baseRecord({ context: undefined }));
    const json = line.trimEnd().slice(line.trimEnd().indexOf('{'));
    const parsed = JSON.parse(json);
    expect(parsed).toEqual({ fields: {}, context: {} });
  });

  test('appends error stack or message when err present', function () {
    const line = formatPretty(
      baseRecord({
        level: 'error',
        err: { name: 'Error', message: 'boom', stack: 'Error: boom\n  at x' },
      })
    );
    expect(line).toContain('boom');
  });

  test('falls back to err.message when no stack', function () {
    const line = formatPretty(
      baseRecord({
        level: 'error',
        err: { name: 'Error', message: 'nostack' },
      })
    );
    expect(line).toContain('nostack');
  });
});

describe('formatJsonLine', function () {
  test('round-trips via JSON.parse', function () {
    const record = baseRecord({ fields: { a: 1 } });
    const line = formatJsonLine(record);
    expect(line.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(line) as LogRecord;
    expect(parsed.level).toBe('info');
    expect(parsed.context?.service).toBe('sync');
    expect(parsed.msg).toBe('hello');
    expect(parsed.fields).toEqual({ a: 1 });
  });

  test('includes err when present', function () {
    const record = baseRecord({
      level: 'error',
      err: { name: 'TypeError', message: 'bad', stack: 's' },
    });
    const parsed = JSON.parse(formatJsonLine(record)) as LogRecord;
    expect(parsed.err?.name).toBe('TypeError');
    expect(parsed.err?.message).toBe('bad');
  });

  test('drops undefined keys', function () {
    const record = baseRecord();
    const parsed = JSON.parse(formatJsonLine(record)) as Record<
      string,
      unknown
    >;
    expect('fields' in parsed).toBe(false);
    expect('err' in parsed).toBe(false);
  });
});
