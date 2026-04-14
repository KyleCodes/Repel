# ADR-006: Classifier Config as Versioned Database Rows
**Date:** 2026-01-01
**Status:** ACCEPTED
**Domain:** data-storage, ai-pipeline

## Context
The AI classifier is configured by a human-readable markdown prompt defining categories, tags, importance criteria, and filtering rules. This prompt will be iterated on frequently. When the prompt changes, existing classifications become stale and may need to be regenerated.

## Decision
Store classifier configs as versioned rows in a `classifier_config` table (one row per org per version, `is_active` flag for current). Classification records reference the `classifier_version` that produced them.

## Alternatives Considered
| Option | Reason Rejected |
|--------|----------------|
| Hardcoded constant in source | Requires a deploy to change the classifier; too high friction for a self-hosted tool being actively tuned |
| File on disk | No per-org customization; no version tracking; requires a deploy or SSH access to change |

## Consequences

### Positive
- Track which config version produced each classification
- Reclassify messages against a new version without a deploy
- Roll back to a previous version without a code deploy
- Per-org customization supported

### Negative / Trade-offs
- `classifier_config` must be seeded during setup
- Application layer must enforce one active config per org
- Reclassification is an explicit operation (not automatic on config change) to avoid unexpected LLM cost spikes

### Risks
- RISK: Config drift between orgs makes debugging harder | MITIGATION: `classifier_version` on each classification row makes the config used traceable

## Compliance
- MUST: Only one `classifier_config` row per org may have `is_active = true`
- MUST: `message_classification` rows MUST reference the `classifier_version` that produced them
- MUST NOT: Hardcode classifier prompts in application code

## Review Trigger
Multiple orgs diverge so significantly in classifier config that a shared schema no longer makes sense.

## Related
- SUPERSEDES: NONE
- RELATED TO: ADR-001
- REFERENCED BY: NONE
