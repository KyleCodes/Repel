import { currentLogContext } from '@repel/logger/context';
import { resolveLogLevel } from './env';
import type { LogLevel } from './levels';
import { meetsThreshold } from './levels';
import { isBrowser } from './runtime';
import { consoleTransport } from './transports/console';
import type {
  Fields,
  LogRecord,
  Logger,
  LoggerOptions,
  Transport,
} from './types';

// Copy an Error into the serializable shape stored on a record.
function captureError(err: Error): LogRecord['err'] {
  return { name: err.name, message: err.message, stack: err.stack };
}

// Resolve error()'s overloaded 2nd/3rd args into a captured error and/or
// fields. A plain object (not an Error) is fields; anything else is the error
// to capture, coerced to an Error if it isn't one already.
function normalizeErrorArg(
  second: unknown,
  third: Fields | undefined
): { err?: Error; fields?: Fields } {
  if (second === undefined) return {};
  const isFields =
    typeof second === 'object' && second !== null && !(second instanceof Error);
  if (isFields) return { fields: second as Fields };
  const err = second instanceof Error ? second : new Error(String(second));
  return { err, fields: third };
}

// Bind a Logger to a service and a set of transports. An explicit level pins the
// threshold; otherwise LOG_LEVEL is read per call, so the level can be changed on
// a running process (e.g. an admin surface) without a restart.
function makeLogger(
  explicitLevel: LogLevel | undefined,
  transports: Transport[],
  boundService: string
): Logger {
  // The active threshold: the pinned level, else the current LOG_LEVEL.
  function resolveLevel(): LogLevel {
    return explicitLevel ?? resolveLogLevel();
  }

  // The resolved ambient log context (incl. service). An explicit bound service
  // overrides the ambient one. Returns undefined when nothing is set, so the
  // record omits `context`.
  function resolveContext(): Fields | undefined {
    const ctx: Fields = { ...currentLogContext() };
    if (boundService) ctx.service = boundService;
    return Object.keys(ctx).length > 0 ? ctx : undefined;
  }

  // The caller's own fields, kept separate from the ambient context. Returns
  // undefined when none, so the record omits `fields`.
  function callFields(call: Fields | undefined): Fields | undefined {
    return call && Object.keys(call).length > 0 ? call : undefined;
  }

  // Assemble a record: context (ambient) and fields (caller) stay distinct.
  function buildRecord(
    level: LogLevel,
    msg: string,
    context: Fields | undefined,
    fields: Fields | undefined,
    err: Error | undefined
  ): LogRecord {
    const record: LogRecord = {
      time: new Date().toISOString(),
      level,
      msg,
    };
    if (context) record.context = context;
    if (fields) record.fields = fields;
    if (err) record.err = captureError(err);
    return record;
  }

  // Fan a record out to every transport.
  function emit(record: LogRecord): void {
    for (const transport of transports) transport.log(record);
  }

  // The shared body of debug/info/warn: gate, build, emit.
  function write(level: LogLevel, msg: string, fields?: Fields): void {
    if (!meetsThreshold(level, resolveLevel())) return;
    emit(
      buildRecord(level, msg, resolveContext(), callFields(fields), undefined)
    );
  }

  // error introspects its 2nd arg: an Error (or coercible) is captured, a plain
  // object is treated as fields. Only error captures errors.
  function error(message: string, second?: unknown, third?: Fields): void {
    if (!meetsThreshold('error', resolveLevel())) return;
    const { err, fields } = normalizeErrorArg(second, third);
    emit(
      buildRecord('error', message, resolveContext(), callFields(fields), err)
    );
  }

  // Raw command result text, not a diagnostic — never gated, never colored,
  // never structured. For structured machine output keep using
  // process.stdout.write(JSON.stringify(...)) directly.
  function output(text: string): void {
    if (isBrowser()) {
      console.log(text);
      return;
    }
    process.stdout.write(text);
  }

  return {
    debug: (msg, fields) => write('debug', msg, fields),
    info: (msg, fields) => write('info', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    error,
    output,
  };
}

export function createLogger(opts?: LoggerOptions): Logger {
  const transports = opts?.transports ?? [consoleTransport()];
  return makeLogger(opts?.level, transports, opts?.service ?? '');
}

// The platform-wide logger. Stateless: service and tracing context resolve from
// the ambient log context per call, and the level from LOG_LEVEL per call — so
// one shared instance behaves correctly in every app and request. Import this
// directly; reserve createLogger() for tests and custom transports.
export const logger: Logger = createLogger();
