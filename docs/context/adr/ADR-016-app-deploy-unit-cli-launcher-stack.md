# ADR-016: App as Deploy Unit; CLI as Privileged Launcher; Stack as Folder

**Date:** 2026-06-20
**Status:** ACCEPTED
**Domain:** deployment, architecture

## Context

The REP-60 restructure (REP-61/62/63) split the backend into per-package `apps/` and `libs/` but left three questions about _deployables_ unanswered, parking placeholders for them: a generic `apps/worker` host, a `libs/transport` queue stub, and a `libs/processing-pipeline` orchestrator stub. None were ever filled. The open questions:

1. What is a "deployable" when the deploy target is a single Ubuntu VM running Docker Compose (no cloud control plane, no CloudFormation/CDK synth)?
2. How does a process get launched with its dependencies/config resolved — and how do we keep a single-process, single-debugger mode for end-to-end work?
3. How is a cohesive business unit (e.g. "sync": a worker, later an event-writer, later a webhook receiver) expressed when Nx tooling assumes one app = one process and offers no first-class "stack"?

The author's mental model is AWS CDK (declare resources in a stack, synth to an artifact, reference resources by logical id). That model does not transfer: at single-VM-Compose scale there is no synth step and no provisioner — the `docker-compose.yml` _is_ the artifact. What does transfer is the _discipline_: name resources, derive their addresses from those names, never hardcode.

## Decision

**An app is a unit of independent deployment.** One app → one image → one Compose service → one scaling knob. An app owns _app logic_ — the HTTP server definition, request parsing, queue-client calls, consumer instantiation, the handler bodies — and delegates to services in `libs/`. Apps are not minimally thin and libs are not maximally fat. Apps are mutually un-importable (`type:app ↛ type:app`) and expose exactly one public entry, `./start` (ADR-015). In production each app is its own container; there is one container per process.

**The cli is a privileged launcher, tagged `type:cli` (not `type:app`).** The cli is the developer toolbox: short-lived, never deployed, and the only package permitted to import an app's `./start`. The boundary rules are `type:cli → type:lib, type:app`; `type:app → type:lib`; `type:lib → not type:app, not type:cli` (manifesto §5 Rule 9). `cli services run <name>` resolves config, renders the env a service needs, and calls that app's `start()`. `cli services run --all` calls every registered app's `start()` in **one process**, giving a single event loop and a single step-debugger for end-to-end work — this replaces the old `MODE=all`. In production Compose invokes `cli services run <name>` per service, so config/env resolution is identical to development.

**A stack is a folder, not a package.** A stack is a grouping directory of related apps (e.g. `apps/sync/`) plus a `docker-compose` fragment that deploys them together — the spiritual equivalent of a CloudFormation/CDK stack, minus the synth step. It has no `package.json` and is invisible to the Nx project graph, exactly like the `packages/backend/` grouping directory. The cohesion lives in the stack's lib (`libs/sync`); the apps are thin composition roots. A stack grows by adding sibling apps, never by teaching one app to run multiple processes.

**Compose is the deploy substrate; the CDK analogues are flat.** Service-name DNS is the `Ref` (a service reaches `postgres:5432` by name on the Compose network); env-var injection is the `GetAtt` (an app's container is handed the addresses/secrets it needs as env). There is no synth, no drift reconciler, no cross-stack reference machinery, and no Kubernetes. Terraform, if used at all, is scoped to provisioning the VM itself and lives outside the Nx graph.

## Alternatives Considered

| Option                                                       | Reason Rejected                                                                                                                                                                   |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One Nx app with multiple build entrypoints (worker, writer…) | No Nx tooling support (`nx affected`/`setup-docker` assume one app = one process); issue #4448 (multiple artifacts per app) closed stale. Pays the split cost, loses the tooling. |
| A separate `dev-supervisor` app that imports other apps      | Would be an app importing apps (forbidden) or a lib importing apps (forbidden + apps un-importable). The launcher must be a distinct privileged kind — hence `type:cli`.          |
| CLI spawns child processes instead of importing `start()`    | Loses true single-process / single-debugger `--all`; the value of the cli is config/env resolution, which is cleaner calling `start()` in-process than templating a subprocess.   |
| A manifest → `docker-compose.yml` generator (mini-CDK)       | No mature precedent for custom-app backends; serious self-hosted projects ship hand-written compose + `.env`. Adds a synth step with no payoff at this scale.                     |
| Kubernetes / k3s on the single VM                            | A control plane to schedule onto one machine. All overhead, no payoff until multi-host.                                                                                           |

## Consequences

### Positive

- Each app is independently deployable and scalable; `nx affected` scopes rebuilds per app.
- One launcher owns config/env resolution for every deployable, identical in dev and prod.
- Single-process, single-debugger `--all` is preserved without a supervisor app and without fattening libs.
- "Stack" gives CDK-shaped cohesion as a folder + compose fragment, with zero new Nx machinery.
- The app/lib boundary stays clean: the one licensed app-import (`type:cli → type:app/start`) reads as a principle, not a per-package exception.

### Negative / Trade-offs

- More Compose services and per-app `package.json`/Dockerfile boilerplate than a single monolithic image.
- `./start` is a public surface on apps that otherwise have none; ADR-015 carries the exception.
- The cli holds privilege the boundary rules grant nothing else; misuse (importing app internals beyond `./start`) is a review concern, not a machine-enforced one.

### Risks

- RISK: The cli accretes business logic because it can reach everything | MITIGATION: The cli is a launcher and a thin facade over services (manifesto §6); orchestration lives in services, not in the cli.

## Compliance

- MUST: Each runtime role is its own `type:app` package; apps never import each other.
- MUST: An app exposes only `./start`; only `type:cli` consumes it (ADR-015).
- MUST: Processes are launched via `cli services run <name>`; no `MODE` switch, no generic worker host.
- MUST: A stack is a folder (no `package.json`) plus a compose fragment; its logic lives in a lib.
- MUST: Inter-service references use Compose service-name DNS + injected env vars; no hardcoded hosts/IPs.
- MUST NOT: Introduce a synth/codegen step that generates `docker-compose.yml`, or Kubernetes, without a new ADR.

## Review Trigger

A second VM or a need to schedule across hosts (revisit Compose vs. an orchestrator), or the per-app Compose boilerplate becoming a real maintenance burden (revisit a generation step).

## Related

- SUPERSEDES: NONE
- RELATED TO: ADR-003 (single monolith, multiple entrypoints), ADR-004 (the queue this launches consumers for), ADR-015 (apps expose `./start` only)
- REFERENCED BY: NONE
