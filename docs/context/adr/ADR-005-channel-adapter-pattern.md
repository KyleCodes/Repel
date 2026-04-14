# ADR-005: Channel Abstraction via Adapter Pattern
**Date:** 2026-01-01
**Status:** ACCEPTED
**Domain:** architecture, extensibility

## Context
The MVP supports Gmail and iCloud email. The design must accommodate future channels (LinkedIn, iMessage, Slack, Discord, WhatsApp) without rewriting the data model or processing pipeline.

## Decision
Define a `ChannelAdapter` interface with `sync()` and `send()` methods. Each provider implements this interface. The pipeline and API operate on channel-agnostic `message` records. Channel-specific data is preserved in `message_raw` and accessed only when needed.

## Alternatives Considered
| Option | Reason Rejected |
|--------|----------------|
| Channel-specific tables | Query patterns diverge per channel; adding a new channel requires schema migrations and API changes |
| Channel-specific fields on `message` | Table becomes sparse as channels multiply; field semantics diverge |

## Consequences

### Positive
- Adding a new channel = new `channels/<name>/ingress.ts` + `channels/<name>/egress.ts` + enum value + migration
- No changes to pipeline, agent, or API when adding a channel
- Channel-specific raw data preserved in `message_raw` for debugging and re-processing

### Negative / Trade-offs
- Some information loss in normalization (Slack reactions, iMessage read receipts not in `message` table)
- `message` table carries email-ish fields that are empty for non-email channels
- Thread resolution varies by channel and requires dispatch logic in `channels/lib/threading.ts`

### Risks
- RISK: `IngressMessage` type needs extension for channel-specific concepts | MITIGATION: Add optional fields; changing required fields is a breaking change and requires an ADR

## Compliance
- MUST: All channels implement the `ChannelAdapter` interface
- MUST: Channel-specific logic MUST live in `channels/<provider>/`; the pipeline MUST NOT import from channel-specific modules directly
- MUST NOT: Add channel-specific columns to the `message` table

## Review Trigger
A new channel introduces concepts fundamentally incompatible with the `IngressMessage` schema (e.g., a channel with no concept of sender/recipient).

## Related
- SUPERSEDES: NONE
- RELATED TO: ADR-001
- REFERENCED BY: NONE
