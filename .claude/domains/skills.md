# Domain Skills

Domain-specific skill files that agents should load based on ticket keywords.
Each entry maps a set of keywords to a skill file path (relative to `.claude/skills/`).
Used by `codebase-explorer`, `architect`, and `backend-engineer` to load relevant context.

| Keywords                                                                | Skill File            | Description                                                            |
| ----------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------- |
| Linear, ticket, issue, project board, cycle, backlog, C-, status update | linearis-cli/SKILL.md | Operate Linear via `linearis` CLI in a discover-then-act flow          |
| Notion, blueprint, spec doc, RFC page, ntn, workspace page              | notion-cli/SKILL.md   | Fetch and process Notion pages via `ntn` CLI                           |
| Datadog, monitor, dashboard, logs, metrics, events, incident, pup       | datadog-pup/SKILL.md  | Operate Datadog through Pup CLI with read-first investigation patterns |

<!-- Example:
| RTP, UDP audio, CallSession, SDP, PCMU, packet format, audio path | VoIP/RTPArchitecture.md | RTP media architecture |
| SIP, INVITE, ACK, BYE, CANCEL, dialog, signalling | VoIP/SIP.md | SIP signalling stack |
| STT, TTS, LLM, VAD, provider interface | VoIP/MediaProviders.md | Media provider integrations |
| Element, Pad, Pipeline, EventBus, pipeline topology | VoIP/PipelineArchitecture.md | Media pipeline architecture |
-->
