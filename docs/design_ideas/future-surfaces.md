# Future Surfaces — Deferred

**Status:** DEFERRED — not in scope for the v1 sync + CLI work (Foundations / Provider Integrations / CLI Everything / Syncer).
**Date filed:** 2026-04-14 (expanded 2026-04-15 during project breakdown)

Surfaces and projects named in the product spec or surfaced during planning that are not part of the near-term project breakdown. Filed here so they don't get forgotten and so we don't accidentally design ourselves out of supporting them. When one of these gets picked up, create the Linear project then — not before.

## Messages & Threads: Read Path

Once Syncer writes messages into the database, they need to become viewable from the CLI. Reading is a separate concern with its own complexity: thread grouping, filtering, pagination, body rendering for the terminal. Tickets will live under their own project when it's created.

**Rough scope:**

- `core/message/` expansion — list queries with filters (account, channel, date, starred, unread)
- `core/thread/` — thread aggregation, subject normalization, message counts, `last_message_at` maintenance during insert
- `repel messages list` / `messages show <id>` / `messages mark-read` / `star` / `archive`
- `repel threads list` / `threads show <id>`
- Terminal-friendly formatting with `--json` for scripting

**Trigger to revisit:** Syncer ships end-to-end and the first real Gmail messages land in the database. At that point you'll want to see them.

**Out of scope at first pass:** classification, tagging, importance scoring, search (search deserves its own project).

## Processors (classification, summarization, draft replies, contact extraction)

The full derived-fact pipeline. This is where the locked deferral from `docs/design_ideas/derived-fact-model.md` gets picked back up. Contacts also fall out of this work naturally — contact extraction is just one processor among many, and once processors exist the `contact` / `contact_handle` tables get populated as a side effect.

**Trigger to revisit:** Syncer has written a real corpus of messages AND the product is boring enough to read raw that you want intelligence on top. Both conditions matter — don't build processors against an empty database, and don't build them before you've felt the pain of unfiltered mail.

**Critical decision to make first:** event-sourced pipeline vs table-based `processor` / `processor_run` / `derived_fact`. Full context in `docs/design_ideas/derived-fact-model.md`. Do NOT start implementation before resolving this — switching after the fact means migrating live data.

## Scheduler / Automation

v1 is manual-sync-via-CLI. You'll get tired of it. Scheduled incremental syncs (simple interval-per-account) and Gmail Pub/Sub push notifications for near-real-time ingestion.

**Rough scope:**

- Scheduler component inside the worker process, enqueues `sync.incremental` per active `provider_account` at configured intervals
- Configuration: per-account interval, enable/disable, last-tick tracking (dedup_key on `job_queue` already prevents double-enqueue on restart, but track for observability)
- Gmail Pub/Sub push: `api/webhooks/gmail-push/` receives push notifications, translates to `sync.range` jobs
- Observability: last scheduled tick, next tick, recent job history per account

**Trigger to revisit:** you're running `repel sync run` more than twice a day and it feels annoying. Or you want near-real-time notifications for important messages.

**Out of scope:** general automation rules ("when I get X, do Y"). That's a processor-layer concern.

## API Everything (REST + SPA + MCP)

The product spec commits to a REST API and a React SPA frontend, and to an MCP surface for conversational mailbox access. All deferred until the CLI proves the service contracts are right.

**Trigger to revisit:** you want to read your inbox from something other than a terminal, OR a second user needs access, OR you want to talk to your inbox via Claude Desktop.

**Do not create API-related Linear projects until at least one of those triggers fires.** Creating scaffolding for routes that don't yet exist is the same smell as the throwaway `domains/` placeholders we're about to delete.

## MCP server

The product spec commits to a "Conversational Mailbox" feature backed by MCP against the application API ("Across all accounts, who do I need to reply to?", "When do I need to be at the airport today?"). This is a real product surface, not a maybe.

**Why deferred:** depends on a stable internal API surface (services, query patterns) that does not yet exist. Building it before sync and the basic message read path would be premature.

**Open at decision time:**

- Does the MCP server speak directly to the database via repos/services, or does it call the REST API internally? Former is faster and avoids serialization; latter reuses auth/validation/permission logic. Probable answer: call services directly, share auth as a function, not as HTTP middleware.
- What is the shape of the MCP tool surface — one tool per vertical (`messages.search`, `threads.list`, `contacts.find`), or one generic `query` tool that takes a structured query DSL? Probable answer: one tool per vertical, since LLM clients pick tools better than they construct DSLs.
- Where does it live? Provisional answer: `apps/server/src/api/mcp/` as a sibling of `api/rest/` and `api/webhooks/`.

**Trigger to revisit:** REST API for the SPA exists and is stable, OR a user explicitly wants to talk to their inbox via Claude Desktop / Cursor before the SPA ships.
