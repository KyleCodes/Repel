import type { LogLevel } from './levels';

export type Fields = Record<string, unknown>;
export type LogFormat = 'pretty' | 'json';

export interface LogRecord {
  time: string;
  level: LogLevel;
  msg: string;
  // The resolved ambient log context (service + traceId + any scope ids).
  // Omitted when there is no service and no ambient context.
  context?: Fields;
  // Only what the caller passed at the log site. Omitted when none.
  fields?: Fields;
  err?: { name: string; message: string; stack?: string };
}

export interface Transport {
  name: string;
  log(record: LogRecord): void;
  flush?(): Promise<void> | void;
}

export interface Logger {
  debug(msg: string, fields?: Fields): void;
  info(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  error(message: string, fields?: Fields): void;
  error(message: string, error: unknown, fields?: Fields): void;
  output(text: string): void;
}

export interface LoggerOptions {
  service?: string;
  level?: LogLevel;
  transports?: Transport[];
}
