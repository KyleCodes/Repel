# ADR-012: CLI Structure — Schemas Colocated with Handlers

**Date:** 2026-05-06
**Status:** ACCEPTED
**Domain:** conventions, architecture

## Context

The `repel` CLI is becoming the canonical interface for dev-facing operations across multiple namespaces (`db`, eventually `jobs`, etc.). We need a layout convention that holds for both small namespaces (one file) and large namespaces (split into multiple handler files), and a place for cross-namespace helpers.

## Decision

- Each namespace lives under `cli/`. Small namespaces are one file (`cli/<ns>.ts`); large namespaces split into multiple handler files under `cli/<ns>/`.
- **Zod schemas colocate with the handler(s) they validate.** One schemas file when the namespace is one handler file (`cli/schemas/<ns>.ts`). When handlers split, schemas split with them and live next to their handler.
- Cross-namespace helpers go in `cli/lib/`, scoped per the `lib/` rule in TypeScript Code Conventions (lowest common ancestor of dependents).
- Each Commander `.action(...)` is the parse boundary: build raw input → `Schema.safeParse` → exit non-zero with zod issues, or call `runX(input)` with the typed result.

## Compliance

- MUST: handlers accept a single typed input arg derived via `z.infer`.
- MUST: `.action()` calls `Schema.safeParse(...)` and exits non-zero on failure.
- MUST: schemas live next to the handler(s) they validate — never in a global cross-namespace `schemas/` dir.
- SHOULD: keep a namespace in one file until it's hard to read; only then split.
