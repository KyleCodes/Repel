import { resolveLogFormat } from '../env';
import { formatJsonLine, formatPretty } from '../format';
import { isBrowser, isTTY } from '../runtime';
import type { LogFormat, LogRecord, Transport } from '../types';

export interface ConsoleTransportOptions {
  format?: LogFormat;
  write?: (s: string) => void;
  browserConsole?: Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;
  runtime?: { isBrowser(): boolean; isTTY(): boolean };
}

function browserLine(record: LogRecord): string {
  const service = record.context?.service;
  const prefix = typeof service === 'string' && service ? `${service}: ` : '';
  // Caller fields and ambient context in one envelope (fields first), matching
  // the server pretty format.
  const envelope = {
    fields: record.fields ?? {},
    context: record.context ?? {},
  };
  let line = `[${record.level.toUpperCase()}] ${prefix}${record.msg} ${JSON.stringify(envelope)}`;
  if (record.err) {
    line += ` ${record.err.stack ?? record.err.message}`;
  }
  return line;
}

export function consoleTransport(opts?: ConsoleTransportOptions): Transport {
  const runtime = opts?.runtime ?? { isBrowser, isTTY };
  const browserConsole = opts?.browserConsole ?? console;
  // All diagnostics go to stderr. stdout is reserved as the data channel
  // (result JSON via process.stdout.write, and the logger's output()).
  const write =
    opts?.write ??
    ((s: string) => {
      process.stderr.write(s);
    });

  function log(record: LogRecord): void {
    if (runtime.isBrowser()) {
      browserConsole[record.level](browserLine(record));
      return;
    }
    const format =
      opts?.format ??
      resolveLogFormat() ??
      (runtime.isTTY() ? 'pretty' : 'json');
    write(format === 'pretty' ? formatPretty(record) : formatJsonLine(record));
  }

  return { name: 'console', log };
}
