import type { LogLevel } from './levels';
import { resolveThreshold } from './levels';
import type { LogFormat } from './types';

// The only module that touches process / import.meta, so the rest of the
// package stays pure and isomorphic. Backend env comes from process.env;
// the Vite/React frontend has no process and exposes VITE_-prefixed vars on
// import.meta.env.
function readEnv(name: string): string | undefined {
  if (typeof process !== 'undefined' && process.env) {
    const v = process.env[name];
    if (v) return v;
  }
  // Root tsconfig carries only bun-types (no vite/client), so import.meta.env
  // is untyped here. The cast is deliberate — do not add vite types.
  const meta = import.meta as unknown as {
    env?: Record<string, string | undefined>;
  };
  if (meta?.env) {
    const v = meta.env[`VITE_${name}`] ?? meta.env[name];
    if (v) return v;
  }
  return undefined;
}

export function resolveLogLevel(): LogLevel {
  return resolveThreshold(readEnv('LOG_LEVEL'), 'info');
}

export function resolveLogFormat(): LogFormat | undefined {
  const raw = readEnv('LOG_FORMAT');
  if (raw === 'json' || raw === 'pretty') return raw;
  return undefined;
}
