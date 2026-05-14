# ADR-012: CLI Structure — handler + sibling `schemas/`

**Date:** 2026-05-06 (amended 2026-05-13: full Decision + Compliance rewrite — see History)
**Status:** ACCEPTED
**Domain:** conventions, architecture

## Context

The `repel` CLI is becoming the canonical interface for dev-facing operations across multiple namespaces (`db`, eventually `jobs`, etc.). We need a layout convention that holds for both small namespaces and large ones (where subcommand groups split out into their own files), and a place for cross-namespace helpers. The original 2026-05-06 Decision (single-file namespaces + a global `cli/schemas/<ns>.ts`) contradicted what REP-38/39 actually shipped (sibling schemas next to the handler that uses them). REP-42 codifies the as-built shape and drops the now-vestigial `admin/` umbrella that REP-39 carried over from an earlier layout.

## Decision

- Every CLI namespace is a directory `cli/<ns>/` containing `handler.ts`. There is no single-file form (`cli/<ns>.ts` is not permitted) — uniformity beats the small-namespace win.
- Subcommand groups within a namespace nest as `cli/<ns>/<group>/handler.ts`. The parent namespace's `handler.ts` delegates to each group via a `registerXCommands(parent)` function imported from the group's `handler.ts`.
- Zod schemas live in a `schemas/` directory sibling to the handler that consumes them. The entrypoint is `schemas/index.ts`. Imports use `from './schemas/index.ts'`. Splitting a large `schemas/index.ts` into multiple files (e.g. `schemas/clone.ts`, `schemas/drop.ts`) is a future move; the directory shape pre-pays for it.
- There is no `admin/` umbrella directory under `cli/`. Namespaces are flat under `cli/` and named by what they operate on, not by privilege tier.
- Helpers tier by scope. Helpers used inside one namespace live in `cli/<ns>/lib/`; helpers used across namespaces live in `cli/lib/`; helpers used by both `cli/` and another tree (e.g. `db/`) live at the lowest common ancestor (typically `apps/server/src/lib/`).
- Each Commander `.action(...)` is the parse boundary. `.action()` MUST call `parseOrExit(Schema, rawInput)` from `cli/lib/parse-or-exit.ts`, never raw `Schema.safeParse`.
- Zod schemas MUST be exported as `*InputSchema`. The inferred TypeScript type MUST be exported as `*Input` (drop the `Schema` suffix). The naming applies project-wide once `api/` adopts zod.

## Compliance

- MUST: Every namespace is a directory `cli/<ns>/` with `handler.ts` at its root.
- MUST: Every handler has a sibling `schemas/` directory containing `index.ts`. Imports use `from './schemas/index.ts'`.
- MUST: `.action(...)` callbacks call `parseOrExit(Schema, rawInput)` and pass the typed result to a `runX(input)` function.
- MUST: Schemas are exported as `<Verb>InputSchema`; the inferred type as `<Verb>Input`.
- MUST: No directory under `cli/` or `db/` is named `admin/`.
- MUST NOT: Schemas live in a global cross-namespace `cli/schemas/` directory.
- SHOULD: Helpers placed by scope per the tiering rule in Decision.

## Related

- RELATED TO: ADR-009 (vertical core layout), ADR-010 (parallel transport trees — `cli/` and `api/`)

## History

- **2026-05-06** — Original Decision: namespaces could be single files (`cli/<ns>.ts`) or directories; schemas colocated under `cli/schemas/<ns>.ts`. Theoretical — the only namespace was `db`, in-flight as part of REP-38.
- **2026-05-13** — Full Decision + Compliance rewrite (this entry). The 2026-05-06 shape contradicted REP-38/39's actual implementation, which shipped a sibling-schemas layout (`cli/admin/db/schemas.ts`) under a vestigial `admin/` directory. REP-42 drops `admin/`, splits the `db` handler into a `migrations/` subgroup, and codifies the `schemas/index.ts` pattern that scales with subgroup splits. The amendment lands one week after the original ratification — acknowledged as early churn, justified by the fact that the original ADR was written without any implementation pressure to validate it.
