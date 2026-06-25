import { AsyncLocalStorage } from 'node:async_hooks';
import type { LogContext } from './types';

export type { LogContext } from './types';

const als = new AsyncLocalStorage<LogContext>();

// Fallback for pre-context logs (boot output before any runWithLogContext).
// runWithLogContext always wins: currentLogContext returns this only when no
// store is active.
let fallback: LogContext | undefined;

export function runWithLogContext<T>(
  fields: Partial<LogContext>,
  fn: () => T
): T {
  const merged: LogContext = { ...currentLogContext(), ...fields };
  return als.run(merged, fn);
}

export function currentLogContext(): LogContext | undefined {
  return als.getStore() ?? fallback;
}

export function currentService(): string | undefined {
  return currentLogContext()?.service;
}

export function setService(name: string): void {
  // An empty name clears the fallback service rather than setting service:'' —
  // empty service means "no service", and the context omits it entirely.
  if (!name) {
    if (fallback) delete fallback.service;
    if (fallback && Object.keys(fallback).length === 0) fallback = undefined;
    return;
  }
  fallback = { ...fallback, service: name };
}
