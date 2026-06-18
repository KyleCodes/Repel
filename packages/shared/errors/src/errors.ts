// Root of the application's domain-error hierarchy. Every error a feature
// service throws to signal a known, expected failure (vs. an unhandled crash)
// extends AppError, directly or transitively. The facade layer (api/, cli/)
// uses `instanceof AppError` at its error boundary to distinguish "domain
// error, safe to surface to the caller" from "unknown runtime error, scrub
// and 500".
//
// AppError carries no HTTP knowledge by design — Rule 1a. HTTP / GraphQL
// status mapping lives in api/middleware/, keyed off the concrete subclass.

export abstract class AppError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}
