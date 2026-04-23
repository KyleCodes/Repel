# Scaffold Cleanup — Pending

**Status:** Pending — execute as part of the first real implementation work, not as a standalone ticket.
**Date filed:** 2026-04-14

The current `apps/server/src/` tree mixes real foundational code with throwaway scaffolds that demonstrated the repo/service/mapper pattern but were never intended to ship. This file lists what stays, what goes, and what gets relocated.

## Keep as-is

- `apps/server/src/db/` — Kysely client, transaction helpers, runtime. Real foundation.
- `apps/server/src/main.ts` — server entrypoint.
- `apps/server/src/cli.ts` — CLI entrypoint shell. Will grow significantly but the file stays.
- `apps/server/src/api/router.ts` — empty/placeholder. Will be reorganized when REST surface is built but the file is harmless until then.

## Keep — these are real

- `apps/server/src/domains/org/` — `org` is a first-class entity in `docs/03-sql-schema.md`. The repo, service, mapper, and types stay (subject to schema review against locked decisions, but the directory does not move).
- `apps/server/src/domains/user/` — same as `org`. First-class entity, foundational for tenancy.

These two are the only `domains/` subdirectories that survive the rename to whatever-we-pick-instead-of-`domains/`.

## Delete

- `apps/server/src/domains/providers/` — placeholder. Conceptually superseded by the new top-level `providers/` directory locked in ADR-005, which has a fundamentally different shape (definition + adapter + lib protocols, not repo/service/mapper). Nothing in the new providers layer reuses code from this directory.
- `apps/server/src/domains/account-setup/` — placeholder. Will be replaced by real CLI commands wired into actual provider OAuth/credential flows under the future CLI work.

## Relocate / rename

- `domains/` itself — likely to be renamed (the term overloads two different meanings: "DDD bounded contexts" and "first-segment API verticals"). See open conversation about the rename. The `org/` and `user/` subdirectories move with whatever the new name becomes.

## Why not file these as Linear cleanup tickets now?

These deletions only make sense in the context of *replacing* the placeholders with real implementations. A bare "delete these files" ticket would leave the codebase in a worse state than the placeholders did. Better: each affected Linear project (Provider Adapters, CLI Foundation) calls out the placeholder removal as part of its scope so the deletion lands with a working replacement.

## Triggers that close this file

- Provider Adapters project completes phase 1 → `domains/providers/` is deleted.
- CLI Foundation project replaces account setup with real provider linking → `domains/account-setup/` is deleted.
- Domains rename ADR is ratified → `domains/org/` and `domains/user/` move to the new location.

When all three triggers fire, archive this file.
