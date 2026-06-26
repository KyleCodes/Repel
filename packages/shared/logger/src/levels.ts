export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export const LEVEL_WEIGHTS: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function isLogLevel(raw: string): raw is LogLevel {
  return raw in LEVEL_WEIGHTS;
}

export function resolveThreshold(
  raw: string | undefined,
  fallback: LogLevel
): LogLevel {
  if (raw !== undefined && isLogLevel(raw)) return raw;
  return fallback;
}

export function meetsThreshold(level: LogLevel, threshold: LogLevel): boolean {
  return LEVEL_WEIGHTS[level] >= LEVEL_WEIGHTS[threshold];
}
