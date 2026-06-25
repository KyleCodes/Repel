import type { LogContext } from './types';

export type { LogContext } from './types';

let current: LogContext | undefined;

export function runWithLogContext<T>(
  fields: Partial<LogContext>,
  fn: () => T
): T {
  const prev = current;
  current = { ...current, ...fields };
  // For an async fn this restores after the synchronous portion returns the
  // Promise, not after it settles. That is the accepted browser limitation;
  // the browser has no AsyncLocalStorage to span awaits.
  try {
    return fn();
  } finally {
    current = prev;
  }
}

export function currentLogContext(): LogContext | undefined {
  return current;
}

export function currentService(): string | undefined {
  return currentLogContext()?.service;
}

export function setService(name: string): void {
  // An empty name clears the service rather than setting service:'' — empty
  // service means "no service", and the context omits it entirely.
  if (!name) {
    if (current) delete current.service;
    if (current && Object.keys(current).length === 0) current = undefined;
    return;
  }
  current = { ...current, service: name };
}
