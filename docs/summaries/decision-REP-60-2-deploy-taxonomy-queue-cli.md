# DR-REP-60-2: Deploy taxonomy (app/lib/cli/stack), CLI launcher, and queue-as-lib

**Ticket:** REP-60 phase 4 ([Arch] Platform-grouped Nx monorepo restructure) — the deployment/resource model the relocation phases (REP-61/62/63) left open. Docs landed under REP-65; code/config under REP-64 (launcher) and REP-58 (queue).

**Decision:** Settle what a deployable is, how it launches, where the queue lives, and how a business unit is grouped — for a single-VM Docker-Compose target with no cloud control plane. Several points **invert or delete** what the parked placeholders and the stale Syncer tickets assumed; each is recorded below with rationale.

## What was decided

- **Taxonomy.** `app` = unit of independent deployment (one image, one Compose service, one scaling knob), owning app logic and delegating to libs. `lib` = importable code (services, the queue, the consumer runtime). `cli` = the developer toolbox (a new `type:cli` tag, not `type:app`). `stack` = a grouping directory of related apps + a compose fragment — not an Nx entity.
- **`libs/queue`** (`@repel/backend-queue`) is one lib: `enqueue`/`consume` client + `Envelope` + Postgres transport (one `job_queue` table, `topic` column) + consumer runtime. Replaces the deleted `libs/transport`.
- **Deletions:** `libs/processing-pipeline` and `apps/worker` are removed (not deferred). The `Topology` vocabulary is dropped; `Envelope` relocates to `libs/queue` and is reshaped `kind: NodeId` → `topic: string`; `Handler` is reworded.
- **Launch model:** `cli services run <name>` resolves config/env and calls an app's exported `start()`; `cli services run --all` runs every app's `start()` in one process (single debugger). Apps expose only `./start`, consumed solely by `type:cli`.
- **Docs:** manifesto §3/§4/§5/§7/§9/Appendix A rewritten; new ADR-016; ADR-003/004/015 amended; ADR-009 path-touched; `02-deployment-stack.md` carries the operational mechanics.

## Decision 1 — `type:cli` tag; apps expose `./start` (INVERTS "apps expose no exports map")

The single-process `--all` debug mode requires a launcher that _imports and calls_ each app's boot function — but a launcher that imports apps violates every boundary option: an app importing apps is forbidden (`type:app ↛ type:app`), and a lib importing apps is forbidden _and_ impossible (ADR-015 gave apps no `exports`).

**Resolution:** the cli is not an app. It gets its own tag value `type:cli` (a new value of the existing `type:` dimension, not a new dimension), privileged: `type:cli → type:lib, type:app`. Apps gain exactly one public export, `./start`, consumable only by `type:cli` (libs/apps remain fenced out by the boundary rule even though `./start` is listed). This **inverts ADR-003's old "apps expose no `exports` map"** and is recorded as an ADR-015 amendment.

**Why a tag, not a per-package exception:** naming the cli a distinct kind states the truth (short-lived, undeployed, reaches across the system) and makes the one licensed app-import read as a principle rather than "the api app happens to be allowed to import the worker."

**Why import `start()`, not spawn a child process:** the cli's value is config/env resolution; calling `start()` in-process gives true single-process/single-debugger `--all`. (Child-process spawning was the rejected alternative — it loses one-process debug; see ADR-016.)

## Decision 2 — `libs/queue` is one lib; one `job_queue` table with a `topic` column

The stale REP-58 bundled "envelope + consumer + transport" as a generic construct under dead paths. Settled as **one** lib (`libs/queue`) holding all three concerns; a `libs/queue-consumer` split is deferred until cross-package deps prove it cleaner.

**Topology = one table, `topic` column** (not table-per-topic). Validated against the mature Postgres-queue libraries: graphile-worker and River both key logical queues off a name/queue column on one table; **pg-boss adopted automatic per-queue partition tables in v10 and reverted in v11** after thousands of tables caused connection-pooler OOMs. With the project's handful of topics, the per-queue-table failure mode never applies; per-queue partitioning stays an opt-in option for a single high-volume topic.

**`topic` is the swap seam.** `enqueue(topic, payload)` / `consume(topic, handler)` takes `topic` as a plain string; the column storage is internal to the transport. So a later move to RabbitMQ/Kafka/Inngest is a change inside `libs/queue`, never a handler rewrite. Recorded as an ADR-004 amendment.

## Decision 3 — delete processing-pipeline; handlers enqueue directly (no router/topology)

The registry/topology/runner concept (`processing-pipeline`) is deleted, not deferred. Routing collapses to a `topic` a consumer subscribes to; a handler that needs downstream work calls `enqueue(topic, payload)` itself. There is no registry mapping `NodeId`s and no topology fanning out a handler's return value.

**Why:** the registry existed to dispatch by `kind`; with one consumer per topic, the topic _is_ the dispatch. The returned-next-events machinery was never built and the v0 sync needs none of it (Decision 4). An expressive routing layer, if ever warranted (three real multi-stage flows), would be a _new_ lib, not a resurrection of the per-node registry. This replaces manifesto Rule 7 in place (Rules 8/9 keep their numbers, so existing "Rule 9" citations in DR-REP-63-1 and the REP-60 handoff still resolve) and deletes the `Topology` definition in §4.

## Decision 4 — v0 sync is one topic, one consumer, whole sync

v0 has a single `sync` topic and a single consumer (`apps/sync/sync-worker`) that runs the entire sync — driving `gmailAdapter.ingest()` and writing the full message graph — in one handler. No event-writer process, no second queue, no fan-out. (An earlier illustration imagined a `sync-event-queue` + writer; that was an example, not a requirement, and is explicitly not built. A later fan-out would use Decision 3's direct `enqueue`.) On disk the `apps/sync/` stack directory is established now with `sync-worker` as its first app, so adding nodes later is additive.

## Decision 5 — Compose is the deploy artifact; no synth, no Kubernetes

The deploy target is one Ubuntu VM running Docker Compose. The CDK mental model (declare resources, synth to an artifact, reference by logical id) does **not** port: there is no synth step and the `docker-compose.yml` is the artifact. What ports is the discipline — name resources, derive addresses from names. Concretely: service-name DNS = `Ref`; env-var injection = `GetAtt`; override files = environment synth. One container per process. No manifest→compose generator (no mature precedent; over-engineering at this scale). No Kubernetes (a control plane to schedule onto one machine). Terraform, if used at all, is VM-provisioning only and lives outside the Nx graph. Recorded in ADR-016 and `02-deployment-stack.md` (kept out of the manifesto, which excludes operational concerns per §1).

## Config conformance (carried by REP-64 / REP-58, not this doc PR)

- Delete `libs/processing-pipeline`, `libs/transport`, `apps/worker`; remove their three root `tsconfig.json` `references` entries by hand (`nx sync` does not own the root solution list — per DR-REP-63-1's caveat).
- Add the `type:cli` tag + the `@nx/enforce-module-boundaries` rule; retag the cli from `type:app` to `type:cli`; add each app's `./start` export.
- Create `libs/queue`, `libs/sync`, `apps/sync/sync-worker`.
- Rewrite `docker-compose.yml` from the single hardcoded `app` (api) service to per-app services launched via `cli services run <name>`, with an override-file pattern.

## Verification (docs)

- Manifesto grep clean: no surviving `infra/transport`, `infra/db`, `apps/worker`, `processing-pipeline`, `topology.ts`, or `MODE` except as intentional negations / historical notes.
- Rule 7 replaced in place; Rules 8/9 unchanged; `type:cli` row added to the Rule 9 table.
- ADR-016 added and indexed; ADR-003/004/015 amended with dates + cross-references; ADR-009 paths fixed.
- `02-deployment-stack.md` carries the compose/addressing/no-k8s mechanics; the manifesto points to it rather than restating them.
