# ADR-012: CLI Structure — `cli/<namespace>.ts` + Colocated `cli/schemas/<namespace>.ts`
**Date:** 2026-05-06
**Status:** ACCEPTED
**Domain:** conventions, architecture

## Context
The `repel` CLI (Commander, mounted in `apps/server/src/cli.ts`) is becoming the canonical interface for developer-facing operations across multiple bounded contexts — `db` first (REP-19 epic), with `jobs` and others to follow. The original layout placed the `db` Commander wiring and handlers in a single flat `apps/server/src/db/admin/cli.ts` file. Two pressures forced a restructure:

1. New `db` subcommands (`migrate create | up | down`, `status`, `connect`, `query`) bring the file from ~90 LOC to several hundred and introduce per-command input shapes that need validation.
2. We are adopting zod 4 (DR-REP-38-1) and need a place for input schemas per CLI subcommand. Inlining schemas next to handlers couples them to handler files; a sibling `schemas/` directory keeps them discoverable without splintering one file per command.

We also need a discoverable convention for future CLI namespaces (`repel jobs ...`, `repel queue ...`) so a developer adding a new namespace knows exactly where to put files.

## Decision
CLIs are organized as one file per namespace under `cli/`, with a sibling `cli/schemas/` directory containing one schema file per namespace, and a `cli/lib/` directory for reusable helpers shared across namespaces.

```
apps/server/src/db/admin/
  cli/
    db.ts                # Commander wiring + inline runX handlers for `repel db ...`
    schemas/
      db.ts              # zod schemas for every `db` subcommand: CloneInput, DropInput, ...
    lib/
      branch.ts          # getCurrentBranch(), extractTicketSlug(branch)
      env-local.ts       # readDatabaseUrlFromEnvLocal()
```

A future `jobs` namespace adds `cli/jobs.ts` + `cli/schemas/jobs.ts` under wherever the jobs domain lives. Schemas are colocated with the namespace that owns them, not centralized.

Handlers (`runClone`, `runDrop`, ...) stay inline in `cli/<namespace>.ts` while the file is small. Once a namespace file grows past the comfort threshold, split handlers into `cli/handlers/<namespace>.ts` — not before. Premature splitting is rejected.

Each Commander `.action(...)` is the **parse boundary** (DR-REP-38-2). The action callback assembles a raw input object from positional args + options, calls `Schema.safeParse(...)`, prints zod issues and exits non-zero on failure, and on success calls a `runX(input: Input): Promise<void>` handler that takes a single typed argument inferred via `z.infer`.

## Alternatives Considered
| Option | Reason Rejected |
|--------|----------------|
| One schemas file per command (`cli/schemas/clone.ts`, `cli/schemas/drop.ts`, ...) | For `db` alone this is 9+ files with no readability benefit; navigation gets worse, not better |
| Global `apps/server/src/schemas/` shared across all CLIs | Couples unrelated namespaces; a `db` schema change shouldn't show up in a `jobs` PR diff |
| Schemas inline in the handler file | Mixes parse logic with command logic; in a 500-LOC `cli/db.ts` this becomes unreadable |
| One handler file per command (`cli/db/clone.ts`, `cli/db/drop.ts`, ...) | Premature split. Commander wiring still needs a single registrar; per-command files force a re-export step |
| Keep the flat `db/admin/cli.ts` file | Doesn't scale past ~3 commands; no obvious home for cross-namespace helpers |

## Consequences

### Positive
- Adding a new CLI namespace has a single, obvious shape: `cli/<ns>.ts` + `cli/schemas/<ns>.ts`. No design discussion per namespace.
- Schemas and handlers are paired one-to-one, making it impossible to add a command without thinking about its input shape.
- `cli/lib/` becomes the canonical home for cross-namespace helpers (`branch`, `env-local`, future `pgmigrations`-related utilities).
- Handlers are pure functions over typed input, trivially unit-testable without Commander coupling.

### Negative / Trade-offs
- One schemas file per namespace can grow large for a namespace with many subcommands (e.g., `db` will hold 9+ schemas after T2/T3 land). This is the right granularity at this scale; revisit if a single namespace exceeds ~15 commands.
- The `cli/` subdirectory adds one level of nesting versus the old flat layout. Acceptable given the discoverability win.

### Risks
- RISK: A developer adds a CLI namespace but forgets to create the matching `schemas/<ns>.ts` file, leading to inline schemas drifting back into handler files | MITIGATION: This ADR is the documentation. Code review enforces the convention.
- RISK: `cli/lib/` becomes a junk drawer over time | MITIGATION: Apply the same scope-narrowing rule from `lib/` directories generally (see TypeScript Code Conventions): move helpers to the lowest common ancestor of their dependents, not "up" by default.

## Compliance
- MUST: Each CLI namespace lives in `cli/<namespace>.ts` and exports a `register<Namespace>Commands(program)` function that wires the namespace into a parent Commander `program`.
- MUST: Input schemas for a namespace live in `cli/schemas/<namespace>.ts`. Schemas are zod `z.object` definitions; types are derived via `z.infer`, never hand-written.
- MUST: Each `runX(input)` handler accepts a single typed input arg matching its schema. Handlers do not import Commander.
- MUST: The Commander `.action(...)` callback is the parse boundary — it calls `Schema.safeParse(...)` and exits non-zero with zod issue output on failure.
- SHOULD: Inline handlers in `cli/<namespace>.ts` until the file becomes hard to read; only then split into `cli/handlers/<namespace>.ts`.
- SHOULD: Cross-namespace helpers go in `cli/lib/`, scoped to the lowest common ancestor of their dependents.
- MUST NOT: Place schemas in a global `schemas/` directory shared across CLI namespaces.
- MUST NOT: Have handlers read `process.env` directly — env reads happen in lib helpers (e.g., `readDatabaseUrlFromEnvLocal`) or the entrypoint, per the dependency injection convention (Code Conventions § Function Design).
