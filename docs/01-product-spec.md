# Product Spec

## Problem

Email is broken for power users. Multiple accounts across providers, high volume, no intelligence layer. You open your inbox and face an undifferentiated wall of messages — newsletters, receipts, headhunter spam, messages that actually need replies, and time-sensitive items buried under noise.

Existing solutions (Superhuman, Shortwave, Hey) improve the UX but remain single-provider, single-channel, and lack meaningful automation. None of them draft replies, run workflows, or let you query your mailbox conversationally.

## Product

A self-hosted, AI-powered unified inbox that aggregates messages across email providers (and eventually other channels), classifies and scores them, drafts responses, and exposes the entire mailbox as a queryable, automatable system.

### Headline

Stop suffering with your email feed. See a curated inbox ranked by importance. Open a message and find a response already drafted. Become an executive with an AI assistant.

## Core Capabilities

### Aggregation

Ingest historical and incoming email across all connected accounts. Normalize messages into a common representation regardless of provider. Store raw payloads for fidelity, normalized records for query and display.

### Classification and Scoring

An AI agent processes every incoming message. The agent is configuredvia a human-readable markdown prompt that defines categories, tags, and criteria for filtering. Each message receives a category, tags, an importance score (0.0–1.0), and a plain-language summary.

The classifier config is versioned. Reclassification against a new config version is a supported operation.

### Automated Responses

If a message is classified as requiring a response, the system drafts a reply. Drafting may involve researching a knowledge base, searching the web, or applying templates. Drafts are stored and surfaced in the UI for review before sending.

### Automations and Workflows

Incoming messages can trigger automations based on classification. Examples: add to a digest topic, forward to a channel, apply a label, archive, schedule a follow-up. The automation layer is rule-based, keyed on category/tag output from the classifier.

### Conversational Mailbox

Chat with your mailbox using natural language. Backed by MCP against the application API. Examples:

- "Across all accounts, who do I need to reply to?"
- "Show me my upcoming concert tickets."
- "When do I need to be at the airport today?"
- "What headhunters are reaching out with positions that match my background?"
- "What did I miss in the family group chat?"

## Frontend

### Feed Views

- All messages, chronological
- By account
- By category or tag
- By importance score
- Threads view with conversation log

### Command Palette

`Cmd+K` context-aware command palette for quick actions: archive, tag, reply, snooze, search, trigger refresh, bulk operations.

### Chat Interface

Natural language query interface against the mailbox API via MCP.

## Channel Abstraction

The system models messages as channel-agnostic entities. Email is the first channel. The architecture accommodates future channels — LinkedIn, iMessage, SMS, Slack, Discord, WhatsApp — without schema or application rewrites.

Each channel is implemented as an adapter that handles ingress (poll/webhook → normalize) and egress (draft → send). The core processing pipeline operates on normalized messages and is channel-agnostic.

### MVP Channels

- Gmail (OAuth, Gmail API, polling via `users.history.list`)
- iCloud Mail (app-specific password, IMAP, header-based thread resolution)

Both channels are in scope for the initial build. Including two providers from the start validates the channel abstraction and adapter pattern against meaningfully different ingress mechanisms (REST API vs IMAP) and threading strategies (Gmail-native `threadId` vs `References`/`In-Reply-To` header parsing).

### Future Channels (Design-Only)

- LinkedIn messaging
- Facebook Messenger
- iMessage
- Slack
- Discord
- WhatsApp

## Multi-Tenancy

The system supports both B2C and B2B use cases through a unified tenancy model. Every user belongs to an organization. In B2C, the user is the sole member of their org. In B2B, multiple users share an org and can see shared data (contacts, threads, classifications).

All data is scoped to an org. Tenant isolation is enforced at the database level via Postgres row-level security.

## Target User

Power users with multiple email accounts who want automated triage, AI-drafted responses, and the ability to treat their inbox as a queryable database. Initially: the developer building it, running self-hosted on a home server.
