# Derived Fact Model — Design Notes

**Status:** DEFERRED — revisit after sync layer is implemented and we have a real message corpus to process.
**Date filed:** 2026-04-14
**Filed by:** conversation between Kyle and Claude during Q2 of project breakdown discussion

## Why this is deferred

Derived facts are a layer *above* raw sync. The `message` and `message_raw` tables do not need to know derived facts exist. We can ship sync end-to-end (CLI + provider adapters + sync engine + raw storage) without resolving any of the questions below, then revisit with concrete experience of what processing actually needs.

Punting also lets us think about the event-sourcing angle (see "Open Direction" below) without rushing.

## The problem this layer solves

The current `docs/03-sql-schema.md` has per-feature derived tables: `message_classification`, `message_tag`, `message_summary`, `message_importance`, `draft_reply`. Each:

- Has its own ad-hoc versioning column (or none).
- Requires a migration to add a new processor type.
- Cannot be reprocessed cleanly — `message_importance` has `PRIMARY KEY (message_id)` so reruns overwrite history.
- Forces a schema change every time a user wants a new kind of LLM analysis.

Locked product direction (from the conversation):

- One row per derived fact, not per-feature tables.
- Users can specify their own prompts per processing step.
- Possible future: user-defined DAGs, n8n/Zapier integration. ("Needs deeper thought.")
- Re-processing with new processor versions is a first-class operation. Replay is non-destructive.
- Raw vs derived distinction is fundamental. Raw can be re-synced; derived can be re-processed.

## Proposed model — three tables

```sql
CREATE TABLE processor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES org(id),

  kind text NOT NULL,            -- 'classify', 'summarize', 'score_importance', 'draft_reply', 'extract_contacts', ...
  name text NOT NULL,            -- user-facing: "My Spam Filter v2"
  version int NOT NULL,          -- monotonic per (org_id, kind, name)

  prompt_md text,                -- nullable: not all processors are LLM-driven
  config jsonb NOT NULL DEFAULT '{}'::jsonb,  -- model name, temperature, thresholds, anything else
  is_active boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (org_id, kind, name, version)
);

CREATE TABLE processor_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES org(id),
  message_id uuid NOT NULL REFERENCES message(id),
  processor_id uuid NOT NULL REFERENCES processor(id),

  status text NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'skipped')),
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  cost_cents int,                -- optional — track LLM spend
  tokens_in int,
  tokens_out int,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE derived_fact (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES org(id),
  message_id uuid NOT NULL REFERENCES message(id),
  processor_run_id uuid NOT NULL REFERENCES processor_run(id),

  fact_type text NOT NULL,       -- 'classification', 'tag', 'summary', 'importance_score', 'draft_reply', 'contact', ...
  value jsonb NOT NULL,          -- shape depends on fact_type
  confidence float,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_derived_fact_message_type ON derived_fact (message_id, fact_type);
CREATE INDEX idx_derived_fact_org_type ON derived_fact (org_id, fact_type);
CREATE INDEX idx_processor_run_message ON processor_run (message_id, processor_id);
```

## Mapping from the existing schema

| Old table | New representation |
|---|---|
| `message_classification` | `derived_fact` rows where `fact_type='classification'`, `value={category, subcategory}` |
| `message_tag` | `derived_fact` rows where `fact_type='tag'`, `value={tag}` (auto-tags only — see open question D) |
| `message_summary` | `derived_fact` row where `fact_type='summary'`, `value={summary}` |
| `message_importance` | `derived_fact` row where `fact_type='importance_score'`, `value={score, reasoning}` |
| `draft_reply` | `derived_fact` row where `fact_type='draft_reply'`, `value={body_text, body_html, status}` |
| `classifier_config` | `processor` row where `kind='classify'` |

Per-feature query ergonomics come back as views:

```sql
CREATE VIEW v_message_importance AS
SELECT message_id, (value->>'score')::float AS score, ...
FROM derived_fact WHERE fact_type = 'importance_score';
```

## What the model gets you

1. **Adding a processor = TS code + DB row, no migration.** Processor registry in TS defines the `kind`, the input/output schema for the `value` JSONB, and the `run()` function. Users insert a `processor` row to enable it.
2. **Replay is a SELECT + INSERT loop.** "Reprocess all messages from last week with classify v3" = select messages, insert pending `processor_run` rows pointing at the v3 processor, let the worker drain. Old runs and old facts stay. Nothing is mutated.
3. **Multiple competing processors per kind, per org.** A/B testing, side-by-side prompts, gradual rollouts.
4. **Cost and observability built in.** `processor_run.cost_cents`, `tokens_in/out`, `error`. One query answers "spend per processor this month."
5. **DAG-friendly.** Processors can read other `derived_fact` rows for the same message, so `draft_reply` can depend on `classification` having run first. The DAG itself lives in TS as declared input dependencies — the data layer doesn't need to change to support it.
6. **Job queue link is clean.** `job_queue.payload = {processor_run_id}` instead of opaque blobs.

## Open Direction — event-sourced processing pipeline

**Kyle's observation (worth promoting to a primary design option when this layer is revisited):**

> seems like this table could be a materialized view on top of event logs emitted by the processing pipeline as a message flows through

This reframes the model. Instead of `processor_run` being the source of truth, it becomes a *projection* over an append-only event log:

```sql
CREATE TABLE processing_event (
  id bigserial PRIMARY KEY,
  org_id uuid NOT NULL,
  message_id uuid NOT NULL,
  processor_run_id uuid NOT NULL,
  event_type text NOT NULL,          -- 'run_pending', 'run_started', 'tokens_consumed', 'run_succeeded', 'run_failed', ...
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
```

`processor_run` and possibly `derived_fact` become projections — either materialized views refreshed on a schedule, or trigger-maintained projection tables, or rebuilt on demand from the log.

### Why this is interesting

- **Full pipeline history.** Time-travel debugging — "what did the system know about message X at 3pm yesterday?"
- **Multi-consumer fan-out.** A UI live-tail, a Datadog exporter, a customer webhook, an n8n bridge can all subscribe to the same event log without coupling. Aligns with the future "outbound integrations" layer (`integrations/`, distinct from `channels/`).
- **Replay primitive is already in the model.** Replaying processing = selecting events from the log and re-projecting. No special-casing.
- **Audit log for free.** "Did contact-extract run on message X?" is a log query.

### Why this is not free

- More moving parts: event schema to maintain, projection logic to write and test.
- Materialized views don't refresh themselves — either schedule a refresh, replace with a trigger-maintained projection, or rebuild on demand. Each option has tradeoffs.
- Storage grows fast — events are append-only and we'll want a retention policy.
- Versioning the event schema is its own discipline (additive-only, deprecation windows, upcasters).
- The "obvious" thing is the table-based model above. Event sourcing is an architectural commitment that should be made deliberately, not slid into.

### When to decide

Before implementing the pipeline, not after. Once the worker is dequeueing jobs and writing to `processor_run` directly, switching to event sourcing later means migrating live data and rewriting the worker. Cheaper to choose up front.

## Open questions (from the original conversation, still unresolved)

**(A) `processor.kind` as text vs enum.** Probably text, with a TS registry as source of truth and a parity test (same pattern as the provider registry in ADR-005). Whole point is extensibility without migrations.

**(B) `processor_run` per message, or per batch?** Probably per message — same shape as single-message runs, same query patterns, no batch/single special-casing. Storage is cheap.

**(C) `derived_fact.value` shape — fully untyped or schema-validated per `fact_type`?** Probably JSONB at rest, Zod schemas in TS at the edges. Each processor in the registry exports the schema for its outputs. Drift = runtime error.

**(D) What about manual tags?** Current schema has `message_tag.source IN ('auto', 'manual')`. Manual tags are user input, not a derived fact. Probably keep `message_tag` as its own small CRUD table and let auto-tags live in `derived_fact`. A periodic job could promote high-confidence auto-tags into `message_tag` (or not).

**(E) Cascading invalidation on re-sync.** When a re-synced `message_raw` produces a different normalized `message`, derived facts become stale. Proposal: add `message.content_hash` and `derived_fact.message_content_hash`. A fact is "fresh" when the hashes match, "stale" otherwise. Replay verbs can target stale facts (`process replay --stale --processor classify`). More flexible than auto-invalidation.

**(F) Where do processor outputs that aren't message-scoped go?** Example: "extract contacts and update the contact graph." The output isn't a fact about the message — it's a side effect on `contact`. Two options:
  - (a) `derived_fact` only stores message-scoped facts; side effects happen in the same TX as the `processor_run` insert.
  - (b) Processors *always* write a `derived_fact` describing what they did, even if the real effect is elsewhere — fact serves as an audit log.

Lean (b) for the audit-log property, especially under the event-sourcing direction where it falls out naturally.

**(G) Directory name for processor entrypoint.** The thing that runs when the queue consumer dequeues a message and dispatches it to processors is an entrypoint (per ADR-003: single monolith, multiple entrypoints), peer of `cli.ts` and `main.ts`. Open: `apps/server/src/processors/`, `workers/`, `automations/`, or `jobs/`? Singular or plural? Resolution depends on the table-vs-event-sourcing call above — the right name follows from what the entrypoint consumes. Decide alongside the rest of this doc when revisited.

## When we revisit this

Triggers for picking this back up:

1. Sync layer is shipping data into `message` / `message_raw` reliably.
2. We have a real corpus to process — at least one user's worth of historical email synced.
3. We're about to write the first processor and need to decide where its output goes.

At that point: re-read this doc, decide event-sourced vs table-based, write the ADR (will likely need to supersede `ADR-006: Classifier Config as Versioned Database Rows` since the new model subsumes it), update `docs/03-sql-schema.md`, and only then write code.

## Related

- `docs/03-sql-schema.md` — current schema (Layer 4: Derived Data, Layer 8: Classifier Configuration). Both will be replaced when this lands.
- `docs/context/adr/ADR-006-classifier-config-versioned-rows.md` — likely superseded when this lands.
- `docs/context/adr/ADR-004-postgres-backed-job-queue.md` — the queue contract changes from opaque payloads to typed `processor_run_id` links.
- `docs/context/adr/ADR-005-provider-account-vocabulary.md` — defines the upstream layer this sits above.
