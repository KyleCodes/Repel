# ADR-015: Module Public Contract via the `exports` Map — No Barrel Files

**Date:** 2026-06-18 (amended 2026-06-20 REP-60 phase 4)
**Status:** ACCEPTED
**Domain:** architecture, conventions

## Context

The monorepo is now split into per-platform workspace packages
(`packages/backend/{apps,libs}/*`, `packages/shared`). Each package needs a
defined public surface: what may other packages import from it, and what is
internal.

Two mechanisms exist to express a package's public surface:

1. A barrel file (`index.ts`) that re-exports the package's public symbols, with
   the package's `exports` map pointing at it (`"." → "./src/index.ts"`).
2. The `exports` map itself listing the real source files that are public, with
   no re-export file.

A barrel file is a file whose only job is to forward other files' exports. It
adds a layer of indirection — to find where a symbol is defined you open the
barrel, then the real file — and a maintenance step: every new public symbol
must be added both where it lives and to the barrel.

The `exports` map already provides encapsulation for free. With
`moduleResolution: bundler` (root `tsconfig.json`) and the Bun/Node runtime, any
import of a path **not listed** in a package's `exports` map fails — at
type-check (the path does not resolve) and at runtime (the resolver hard-blocks
it). So whatever a package lists in `exports` _is_ its entire importable surface;
unlisted files are private with no extra tooling.

`crypto` already follows the no-barrel form (`exports`: `./encryption`,
`./error`; no `index.ts`). Other packages were inconsistent — some exposed a
single `.` barrel, some listed granular subpaths.

## Decision

A package's public contract is its `package.json` `exports` map, listing **real
source files** as granular subpaths. No `index.ts` re-export barrel files, and no
curated `.` aggregation entry. Consumers import the real file
(`@repel/backend-db/tx`, `@repel/http/client`, `@repel/backend-env/accessors`).
Files not listed in `exports` are private.

A module is a **directory** only when it has more than one file; a single-file
module is a flat `<name>.ts`. There is no `index.ts` whose purpose is
re-exporting.

A **single-purpose package** — one whose entire public surface is a single
module — exposes that module at the package root `.` rather than a named subpath,
so consumers import the package name itself (`@repel/enums`, `@repel/errors`,
`@repel/slug`), not `@repel/enums/enums`. This `.` is not an aggregation barrel:
it points at the package's one real source file. A package with more than one
public module uses granular named subpaths (`@repel/http/client`,
`@repel/http/error`).

A file that **composes or contains logic** (e.g. `adapters/src/gmail/index.ts`,
which builds the `gmailAdapter` object from `auth`/`ingest`/`send`/`normalize`)
is a real module file, not a barrel — it is exposed as that module's subpath
(`@repel/backend-adapters/gmail`). The ban is on pure pass-through re-export
files, not on modules that happen to assemble a value.

**Apps (`type:app`) are the exception to "expose your public files".** An app is a
deployable, not a library; its internals are nobody's to import. An app therefore
exposes **exactly one** entry in its `exports` map: `./start`, the function that
boots it (`@repel/backend-api/start` → `startApi`). Everything else in the app is
private. The single licensed consumer of `./start` is the cli (`type:cli`): the
`@nx/enforce-module-boundaries` rules let `type:cli` import `type:app` but forbid
`type:lib` and `type:app` from doing so, so even though `./start` is listed in the
`exports` map, no lib or sibling app can import it — only the launcher can (manifesto
§3, §5 Rule 8; ADR-003). This keeps apps mutually un-importable while giving the
`cli services run` launcher a typed entrypoint to call instead of spawning a process.

## Alternatives Considered

| Option                                  | Reason Rejected                                                                                                                                                                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts` barrel per package           | Re-export ceremony: a file whose only job is forwarding, plus a second edit on every new public symbol, when the `exports` map already declares the contract                                                                                |
| Curated `.` facade per package          | Hides internal file names from consumers (a real benefit) but adds a per-package judgment call — "is this entry curation or pass-through?" — and the same forwarding file. Chose uniformity now; may revisit per-package (see Consequences) |
| No `exports` map (deep imports allowed) | No encapsulation; every internal file is reachable; boundaries are invisible                                                                                                                                                                |

## Consequences

### Positive

- One uniform rule across every package; no "barrel vs not" judgment per package.
- No re-export indirection — every import points at the file that defines the symbol.
- Encapsulation is enforced for free by `exports` at type-check and runtime; no
  lint rule or build plugin needed for cross-package boundaries.
- The `package.json` is the single, declarative place a package states its
  public surface.

### Negative / Trade-offs

- Granular subpaths leak public-file **names** to consumers. Renaming or moving a
  public file changes its subpath and breaks every importer — there is no facade
  to absorb the change. Accepted while packages are small and public surfaces are
  short. A curated facade entry MAY be reintroduced for a specific package if its
  public surface grows large enough that the name-coupling becomes a real burden;
  that is a per-package decision to revisit, not a default.
- The `exports` map grows one line per public file. This is the cost of making
  the contract explicit.

### Scope / Non-Goals

- This ADR governs **cross-package** imports. Preventing a file from reaching
  into a _sibling module's_ internals **within the same package** is not covered
  by `exports` and is out of scope here — it is left to a future module-boundary
  lint pass.

## Compliance

- MUST: Every importable file is listed in its package's `package.json`
  `exports` map. Unlisted files are private.
- MUST NOT: A package ships an `index.ts` (or any file) that only re-exports
  other files. A module entry that composes/contains logic is allowed.
- MUST: A single-file module is a flat `<name>.ts`; a directory is used only for
  a multi-file module.
- MUST: Cross-package imports reference a declared subpath (e.g.
  `@repel/shared/http/client`), never a path outside the `exports` map.
- MUST: A `type:app` package expose exactly one entry, `./start`, and nothing
  else. It is consumed only by the cli (`type:cli`); the boundary rules forbid any
  lib or sibling app from importing it.

## Related

- SUPERSEDES: NONE
- RELATED TO: ADR-003 (apps run by `cli services run`), ADR-016 (app as deploy unit; CLI as privileged launcher)
- REFERENCED BY: NONE
