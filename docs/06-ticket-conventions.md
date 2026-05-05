# Ticket Conventions

How tickets, acceptance criteria, decision records, and ADRs relate.

## Tiers of decision capture

Three places, three different lifespans.

| Tier | Lives in | Audience | Lifespan | Bar |
|---|---|---|---|---|
| **Linear comment DR** | Linear ticket comments | Reviewers and future readers of *this ticket* | Until ticket closes (or as long as Linear retains comments) | Low — capture every meaningful decision made during planning |
| **Disk DR** | `docs/summaries/decision-[ticket-id]-[N]-[topic].md` | Future work on a *different* ticket that needs to know why this code is shaped this way | Permanent (institutional memory per CLAUDE.md) | High — only if the rationale has cross-ticket reach |
| **ADR** | `docs/context/adr/ADR-NNN-[slug].md` | Anyone touching the relevant area of the codebase | Permanent, until superseded by another ADR | Highest — pattern-establishing, project-wide |

## Acceptance criteria

ACs live in the **ticket description**, not in comments. One section, checklist format:

```markdown
## Acceptance criteria

- [ ] <verifiable outcome>
- [ ] <verifiable outcome>
```

Each AC is a verifiable outcome — something a reviewer can confirm by inspecting code, running a command, or reading a file. Avoid implementation prescriptions; ACs describe *what is true* when the ticket is done.

## Decision Records (DRs)

DRs capture *why* a particular approach was chosen, including rejected alternatives.

### When to write a DR (any tier)

Write one when:
- A non-trivial choice was made between viable options.
- The chosen approach is non-obvious from the code alone.
- A reader would otherwise re-litigate the decision.

Don't write a DR for:
- Mechanical choices ("named the variable `x`").
- Decisions fully captured by an existing ADR.

### Default tier: Linear comment

**Default to a Linear comment**, not a disk file. Comments are cheap to write, easy to scan in the ticket, and retire with the ticket.

Format (one comment per DR):

```markdown
**DR-<ticket-id>-<N>: <topic>**

**Decision:** <one-sentence decision>

**Why:** <rationale, including rejected alternatives>

**Satisfies:** <which ACs from the ticket description this DR backs>
```

Numbering is namespaced per ticket (`DR-REP-38-1`, `DR-REP-38-2`, …), per CLAUDE.md.

### Promotion to disk

Promote a DR to `docs/summaries/decision-[ticket-id]-[N]-[topic].md` **only if** at least one of these is true:
- A future ticket in a *different* domain will need to read this rationale to make a coherent change.
- The decision constrains code outside the originating ticket's scope.
- Removing the comment from Linear would lose context the codebase depends on.

If the answer is "the rationale is in the ticket description and the code itself," skip the disk DR.

### Promotion to ADR

Promote to an ADR when the decision establishes a *convention* that future code in this area must follow. ADRs answer "how do we do X here?" — DRs answer "why did we do this specific thing in this ticket?"

ADRs go through `/ratify-adr`. They live in `docs/context/adr/` and are indexed in `docs/context/adr/index.md`.

## AC ↔ DR coverage rule

Every DR must cite the AC(s) it backs (`**Satisfies:** ...`). The mapping is many-to-many:
- One AC can be backed by multiple DRs (e.g., a "creates a file with the right format" AC may be backed by separate DRs on filename convention and header content).
- One DR can back multiple ACs (e.g., a "use zod at the boundary" DR may satisfy both a "schemas exist" AC and a "handlers single-arg-typed" AC).

If a DR satisfies no AC, either:
- The AC is missing from the description (add it), or
- The DR is documenting something that wasn't a real decision (drop it).

If an AC has no DR backing it, that's fine — many ACs are mechanical and don't need a DR.

## Practical workflow

1. **During planning** (`/linear-plan` and pre-planning conversation): identify decisions, write them in the plan file.
2. **Ticket creation:** `/linear-plan` writes ACs into the ticket description and posts each DR as a Linear comment.
3. **Promotion check:** for each DR, ask "does a future ticket in another domain need this rationale?" If yes, also write to `docs/summaries/`. If the decision establishes a convention, propose an ADR.
4. **During execution:** if a new decision surfaces that wasn't in the plan, capture it as a Linear comment on the active ticket using the same format. Promotion check still applies at the end.
5. **Ticket close:** disk DRs and ADRs persist; Linear comments live with the ticket.

## Avoiding sprawl

Symptoms that the bar for disk DRs is too low:
- More than ~3 disk DRs per ticket on average.
- DR files that summarize ticket-internal implementation choices ("we used a Set for the diff").
- DR files no one reads when working on later tickets.

If you notice these, push more decisions down to Linear comments.
