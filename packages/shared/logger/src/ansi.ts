import type { LogLevel } from './levels';

export const ANSI = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  dim: '\x1b[2m',
  white: '\x1b[37m',
} as const;

export function paint(code: string, s: string): string {
  return `${code}${s}${ANSI.reset}`;
}

const LEVEL_COLORS: Readonly<Record<LogLevel, string>> = {
  error: ANSI.red,
  warn: ANSI.yellow,
  debug: `${ANSI.dim}${ANSI.green}`,
  info: ANSI.white,
};

export function colorForLevel(level: LogLevel): string {
  return LEVEL_COLORS[level];
}
