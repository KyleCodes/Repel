# Decision Record: DR-REP-52-1 — Gmail ingest + normalize (v0 capped full sync)

**Ticket:** REP-52 — Gmail adapter: ingest + normalize (v0, capped full sync)
**Date:** 2026-06-10
**Status:** Accepted
**Depends on:** REP-13 (IProviderAdapter contract — DR-REP-13-1), REP-50 (message schema), REP-51 (OAuth + adapter skeleton), REP-22 (CLI + credential encryption)
**Amends:** DR-REP-13-1 (contract surface — see "Contract amendments" below)
**Blocks:** REP-21 (sync runner consumes this `ingest`), REP-53 (incremental/range sync)

## Context

REP-51 shipped the Gmail adapter skeleton with throwing `ingest`/`normalize`
stubs. REP-52 makes both real: a pure `normalize()` that projects a stored raw
Gmail message into the normalized shape, and a v0 `ingest()` that streams a
capped full sync of real messages (and their attachment bytes). The pure/replay
property of `normalize()` is the load-bearing constraint — the platform stores
raw payloads for fidelity and re-runs `normalize` over them to re-derive
normalized rows (product spec; classifier re-runs), so `normalize` must be a
total function of `raw` alone.

## Decisions

### D1 — Hand-rolled REST + parsing; no SDK, no MIME library

Gmail `messages.get?format=full` returns a **pre-parsed** JSON tree
(`mimeType` + `headers[{name,value}]` + nested `parts[]` + base64url `body.data`),
not raw RFC 5322. So `normalize()` is a recursive tree-walk, not a MIME parser.

**Why:** A MIME library (`mailparser`, etc.) parses byte-level RFC822 — using one
would force switching to `format=raw`, discarding Gmail's parse and reintroducing
boundary/encoding/folding edge cases Google already handled. The Gmail SDK
re-adds `google-auth-library` (the heaviest dep, removed in REP-51) and does not
help parse the tree — it only types it. The token primitives are the hand-rolled
ones in `adapters/lib/oauth2/flow.ts`. Consistent with REP-51/REP-22.

### D2 — Credentials passed in (runner-decrypted), tagged for cast-free narrowing

`IngestInput` gains `credentials: ProviderCredentials` and a `providerSlug`
routing tag. `ProviderCredentials = GmailCredentials` (a union of one).
`GmailCredentials` is retagged from a bare `TokenSet` alias to
`{ provider: 'gmail'; tokens: TokenSet }`.

**Why:** The eslint import barrier (Rule 6) forbids `adapters/* → features/*`, so
an adapter physically cannot read/decrypt `provider_account.credentials_encrypted`
— that DB read lives behind `features/accounts/views/`. The contract comment
"the adapter loads its own credentials" was architecturally impossible; the ticket
Notes ("the runner decrypts before handing them to ingest") are correct. The
runner (a facade-layer component, like `cli/accounts/handler.ts` does today)
reads + decrypts and passes credentials in. The `provider` tag lets the adapter
narrow `ProviderCredentials → GmailCredentials` with **zero `as` casts**; when a
second provider widens the union, the narrow stops compiling until a discriminant
check is added (the seam fails loud at the right moment).

**DB storage is unchanged.** What is encrypted at rest is still a bare `TokenSet`
(`cli/accounts/handler.ts` stores `JSON.stringify(authorization.credentials)`).
The `provider` tag is an in-memory adornment the runner stamps from the
`provider_account.provider` column at decrypt time. The auth flow's
`exchange()` still returns a bare `TokenSet` as `ProviderAuthorization.credentials`
(that is what gets stored); the tagged form is only the handed-to-adapter shape.

### D3 — `sentAt` ← `internalDate` (Gmail server receipt time)

`sentAt` is derived from `internalDate` (epoch-ms string → `Date`), not the
client `Date:` header. `receivedAt` stays `null` in v0.

**Why:** `internalDate` is always present (the column is non-null), unspoofable,
and deterministic to parse (`new Date(Number(internalDate))`) — purity-critical.
The `Date:` header is spoofable, occasionally missing/malformed, and would force a
non-deterministic RFC 2822 parse into a function whose headline AC is determinism.
The semantic imprecision (`sentAt` actually carries _received-by-Gmail_ time) is
deliberate and documented in `normalize.ts`; it is reversible because the `Date:`
header survives in `raw.payload` for a future re-normalization if true-send-time
is ever wanted. Chosen because an inbox sorts by "when it landed in my mailbox."

### D4 — Body precedence: capture both, depth-first first-leaf-wins, recurse

`normalize()` captures BOTH `text/plain → bodyText` and `text/html → bodyHtml`.
The walk is depth-first; the first `text/plain` leaf wins `bodyText` and the first
`text/html` leaf wins `bodyHtml`. Nested multiparts (mixed/alternative/related)
are recursed. Attachment parts are excluded as body candidates even when they are
`text/*` (an attached `.txt` is content, not the body).

**Why:** `multipart/alternative` offers equivalent renderings and the schema has a
column for each — `normalize()` doesn't pick, it captures both and lets
downstream/UI decide. First-leaf-wins (not concatenate) avoids the
alternative-vs-mixed trap. Recursion is required because real messages are
commonly `mixed( alternative(plain, html), attachment )`.

### D5 — Attachment bytes ARE fetched, at ingest; metadata on normalized

`normalize()` emits `attachments: NormalizedAttachment[]` — metadata only
(filename, contentType, sizeBytes, externalAttachmentId, contentId, disposition;
**no bytes**). `ingest()` fetches the bytes via `users.messages.attachments.get`
(a third endpoint) and emits them as `AttachmentContent[]` on the `message`
event, keyed to the normalized attachment by `externalAttachmentId`.

**Why (reverses the ticket's "bytes are not fetched"):** Gmail's `format=full`
does **not** include attachment bytes inline — only an `attachmentId`. Bytes
require a separate call possible **only while the token is live during ingest**.
A downstream "attachment fetcher" that re-reads stored raw is therefore
impossible — raw never contains the bytes. Bytes ride the **event**, not
`normalize()`, so `normalize` stays a pure `f(raw)` and re-processing stays
deterministic (metadata re-derived from raw; bytes are write-once-at-ingest,
thereafter in the `attachment` table). Attachment detection: a part is an
attachment if it has a `filename`, a `body.attachmentId`, or
`Content-Disposition: attachment`; inline images are captured with
`disposition: 'inline'` + `contentId`.

### D6 — Cursor `{ historyId: string }`, captured before listing

The `completed` event carries `cursor: { historyId }`, read from
`users.getProfile` **before** the message list loop. REP-52 only emits it; the
runner (REP-21) persists it to `provider_account.sync_cursor` (jsonb, already
exists).

**Why:** Capturing the cursor before listing means the next incremental sync
replays anything that arrived during the backfill — no gap. `sync_cursor` is
`jsonb`, not encrypted bytes: a cursor is not a secret, and jsonb is queryable /
debuggable. The shape mirrors how `credentials` is round-tripped opaquely —
adapter owns the meaning, platform stores it.

### D7 — Fail fast, loud, well-typed (v0); overrides tolerant `normalized: null`

All three per-message failure points propagate and fail the sync with typed
errors: `GmailMessageFetchError` (messages.get), `GmailNormalizeError`
(normalize threw), `GmailAttachmentFetchError` (attachments.get). Terminal
refresh failure → `AuthExpiredError`. This **overrides** the contract's tolerant
`normalized: null`-and-continue (DR-REP-13-1 D3) for v0.

**Why:** v0 proves the pipeline. A `normalize()` throw on a real message is a
parser bug we want to see immediately, not a `null` quietly persisted while the
sync reports success. The tolerant `normalized: null` path is a
production-hardening affordance for large backfills where one malformed message
shouldn't abort — premature while the normalizer is unproven. The field stays in
the contract; v0 simply never emits it. (Error taxonomy: `AuthExpiredError` is on
the cross-provider `AdapterError` base so the runner switches on it for re-auth
vs. transient retry; `GmailIngestError` + the three fetch/normalize subclasses are
provider-specific.)

### D8 — `AppError` widened for `cause`

`AppError` constructor widened to `(message: string, options?: { cause?: unknown })`,
forwarding `options` to `super`. Backward-compatible (optional param).

**Why:** "Well-typed errors" means chaining the underlying `HttpResponseError`
(status/url/body) rather than flattening it into a string. Uses the native ES2022
`Error` cause mechanism. Touches shared `lib/error.ts` (REP-13-era foundational
code) but is additive and low-risk; ingest's error-fidelity requirement justified
it.

### D9 — Contract projection types use `Insertable<>`

`RawMessage`, `NormalizedMessage`, `NormalizedParticipant`, `NormalizedAttachment`
are now `Omit`/`Pick` over **`Insertable<Row>`**, not the bare generated row
interface.

**Why:** The generated rows carry Kysely `ColumnType` brands (`Timestamp`,
`Int8`, `Generated`). The bare `Omit<Message, …>` exposed `sentAt: Timestamp` and
`sizeBytes: Int8` — branded select types an adapter can't construct (`new Date()`
is not assignable to `Timestamp`). `Insertable<>` unwraps these to the writable
insert types (`Date | string`, `bigint | number | string`), which is what
`normalize()` actually produces. The codebase already standardizes on `Insertable`
(`features/accounts/mutations/*`). This refines DR-REP-13-1 D4, which used bare
`Omit` — latent because the projection types had no constructor until REP-52.

### D10 — Layout: ingress/, queries/, normalize at root; auth files unchanged

- `adapters/gmail/ingress/ingest.ts` — the async generator (mirrors `egress/`, no barrel).
- `adapters/gmail/queries/` — `messages.ts`, `attachments.ts`, and `profile.ts`
  (**moved** from gmail root). The REST calls; `profile.ts` is the cursor source
  and first member of the query family.
- `adapters/gmail/normalize.ts` — at gmail root (pure, dual-entry via
  `adapter.normalize()` for re-normalization; not under `ingress/` which would
  imply it's reachable only through a sync).
- `auth.ts` + `oauth.ts` stay at gmail root: `oauth.ts` is shared config consumed
  by both the auth flow and ingest's refresh, so it is not buried under `auth/`.

## Contract amendments (to DR-REP-13-1 / `adapters/types.ts` + `lib/error.ts`)

| Amendment              | From                                         | To                                        |
| ---------------------- | -------------------------------------------- | ----------------------------------------- |
| `AdapterSyncSpec.full` | `{ type: 'full' }`                           | `{ type: 'full'; limit?: number }`        |
| `IngestInput`          | `{ orgId, userId, providerAccountId, spec }` | `+ providerSlug, + credentials`           |
| `NormalizedMessage`    | `… & { participants }`                       | `+ attachments: NormalizedAttachment[]`   |
| `AdapterMessageEvent`  | `{ type, raw, normalized }`                  | `+ attachments: AttachmentContent[]`      |
| projection types       | `Omit<Row, …>`                               | `Omit<Insertable<Row>, …>` (D9)           |
| `GmailCredentials`     | `= TokenSet`                                 | `{ provider: 'gmail'; tokens: TokenSet }` |
| `AppError` ctor        | `(message)`                                  | `(message, options?: { cause? })`         |
| `AuthExpiredError`     | deferred (DR-REP-13-1 D7)                    | added to `adapters/error.ts`              |

REP-21's runner consumes `IngestInput` — it must construct the `providerSlug` +
tagged `credentials` and decrypt before calling `ingest`. No code consumes the old
shape yet (runner not built), so this sets the contract rather than breaking one.

## Files

| File                                                                   | Action           | Description                                    |
| ---------------------------------------------------------------------- | ---------------- | ---------------------------------------------- |
| `apps/server/src/lib/error.ts`                                         | Modified         | `AppError` ctor widened for `cause` (D8).      |
| `apps/server/src/adapters/error.ts`                                    | Modified         | Added `AuthExpiredError` (D7).                 |
| `apps/server/src/adapters/types.ts`                                    | Modified         | Contract amendments + `Insertable` (D2,D5,D9). |
| `apps/server/src/adapters/gmail/types.ts`                              | Modified         | `GmailCredentials` retagged (D2).              |
| `apps/server/src/adapters/gmail/error.ts`                              | Modified         | `GmailIngestError` + 3 subclasses (D7).        |
| `apps/server/src/adapters/gmail/queries/messages.ts`                   | Created          | list + get (format=full) + zod schemas (D1).   |
| `apps/server/src/adapters/gmail/queries/attachments.ts`                | Created          | attachments.get → Buffer (D5).                 |
| `apps/server/src/adapters/gmail/queries/profile.ts`                    | Moved            | from gmail root (D10).                         |
| `apps/server/src/adapters/gmail/normalize.ts`                          | Created          | pure tree-walk (D3,D4,D5).                     |
| `apps/server/src/adapters/gmail/ingress/ingest.ts`                     | Created          | async generator (D2,D6,D7).                    |
| `apps/server/src/adapters/gmail/index.ts`                              | Modified         | wired real ingest/normalize.                   |
| `apps/server/src/adapters/gmail/__tests__/{normalize,index}.test.ts`   | Created/Modified | unit tests.                                    |
| `apps/server/src/adapters/gmail/{ingress,queries}/__tests__/*.test.ts` | Created          | unit tests.                                    |
| `docs/summaries/decision-REP-52-1-gmail-ingest-normalize.md`           | Created          | This DR.                                       |

## Verification

- `bun test apps/server/src` — 332 pass, 0 fail (+39 over baseline 293).
- `bun run typecheck` — clean.
- `bun run lint` — clean (exit 0); adapters↔features barrier not tripped.
- `bun run build` — clean.
- **Manual (live account):** pending — a capped sync against the connected
  `personal` Gmail account via a throwaway driver or REP-21's runner, asserting
  `started → auth → ≤limit message events (raw + populated normalized + attachment
bytes) → completed{cursor,processed}`.

Complies with manifesto Rule 6 (adapters/ does not import features/; the runner
decrypts), Rule 7 (pipeline owns no business logic). Fulfills DR-REP-13-1's
deferred `AuthExpiredError` (REP-14).
