import { ANSI, colorForLevel, paint } from './ansi';
import type { LogRecord } from './types';

export function formatPretty(record: LogRecord): string {
  const time = paint(ANSI.dim, record.time);
  const tag = paint(
    colorForLevel(record.level),
    `[${record.level.toUpperCase()}]`
  );
  const service = record.context?.service;
  const prefix = typeof service === 'string' && service ? `${service}: ` : '';
  // Caller fields and ambient context in one envelope (fields first), so the
  // line carries a single named object rather than two anonymous blobs.
  const envelope = {
    fields: record.fields ?? {},
    context: record.context ?? {},
  };
  let line = `${time} ${tag} ${prefix}${record.msg} ${JSON.stringify(envelope)}`;
  if (record.err) {
    line += `\n${record.err.stack ?? record.err.message}`;
  }
  return `${line}\n`;
}

export function formatJsonLine(record: LogRecord): string {
  // JSON.stringify drops keys whose value is undefined, so optional fields/err
  // are absent rather than null.
  return `${JSON.stringify(record)}\n`;
}
