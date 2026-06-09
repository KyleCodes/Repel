# Runbook: Google Cloud OAuth setup for the Gmail adapter

A manual, per-environment setup. Registers a Google OAuth client so
`repel accounts add gmail` can run the loopback OAuth flow against Google and read
a mailbox via the Gmail REST API (REP-14 / REP-22).

## Why this is clickops, not IaC

The two things this produces — the **OAuth consent screen** and the **OAuth
client** (client ID/secret) — are not exposed by the GCP Terraform provider or by
`gcloud`. Google gates them behind the console because the consent screen is a
trust/branding artifact it reviews. The project + Gmail-API enablement _are_
Terraform-able, but at three one-time projects the IaC machinery costs more than
it returns. So: do it by hand, follow this runbook, repeat per environment.

Revisit IaC only when real GCP _resources_ appear (Pub/Sub for Gmail push
webhooks, Secret Manager, service accounts) — then Terraform those and import the
hand-made projects.

## Model (for an AWS background)

- GCP **Project** ≈ an AWS member account. It is the isolation/billing boundary.
- A personal `@gmail.com` account has **no Organization node** (that needs Google
  Workspace / Cloud Identity on a domain). You don't need one. Projects hang off
  your user directly.
- Strategy: **one Project + one OAuth client per environment** —
  `repel-dev`, `repel-staging`, `repel-prod` — mirroring AWS account-per-env
  isolation. A leaked/revoked dev secret can't touch prod; publishing status and
  quotas are separate.

## What the code expects (must byte-match the console)

From `apps/server/src/adapters/gmail/oauth.ts`:

- Env vars: `REPEL_GMAIL_CLIENT_ID`, `REPEL_GMAIL_CLIENT_SECRET` (in the gitignored
  `apps/server/.env.development`, NOT `.env.local`).
- Scope: `https://www.googleapis.com/auth/gmail.readonly` (single, restricted).
  Also covers `users.getProfile`, used to resolve the account's email.
- Redirect: ephemeral loopback `http://127.0.0.1:<port>/`. This is why the client
  MUST be **Desktop app** type — it allows arbitrary loopback ports. A "Web
  application" client would force pre-registered redirect URIs and fail.
- `access_type=offline` + `prompt=consent` are set in code → Google issues a
  refresh token.

## Per-environment steps (console)

Replace `<env>` with `dev` / `staging` / `prod`.

1. **New Project** named `repel-<env>`. (No org/location prompt on a personal
   account.) Then confirm `repel-<env>` is the **selected project** in the top bar
   before every step below — the GCP equivalent of "right AWS account?".
2. **Enable the Gmail API** — APIs & Services → Library → "Gmail API" → Enable.
   Mandatory; browser consent alone does not authorize API calls. Skipping this is
   the most common silent failure (`Gmail API has not been used in project…`).
3. **OAuth consent screen** — User type **External**. App name `Repel (<env>)` so
   the three are distinguishable on Google's consent screen. Your email for
   support + developer contact.
4. **Add scope** `https://www.googleapis.com/auth/gmail.readonly` (it warns it's
   restricted — fine for personal / <100 users).
5. **Create OAuth client** — Credentials → Create Credentials → OAuth client ID →
   type **Desktop app**, name `client-<env>`. Copy the client ID + secret.
6. **Add yourself as a test user** — OAuth consent screen → Test users. (Owning
   the project ≠ being a test user.)
7. **Publish to production** — Publishing status → Publish app. Do this **even for
   dev**: in "Testing" mode Google expires the refresh token after 7 days and sync
   silently dies. Production needs no security assessment under ~100 users.
8. **Local config** — put the credentials in `apps/server/.env.development`:
   ```
   REPEL_GMAIL_CLIENT_ID=<client id>
   REPEL_GMAIL_CLIENT_SECRET=<client secret>
   ```
   (For staging/prod, these go in that environment's real secret store, not this
   file.)

## Verify (live, after setup)

Pre-flight: `ENCRYPTION_KEY`, `REPEL_GMAIL_CLIENT_ID/SECRET` set; `REPEL_ORG_ID`/
`REPEL_USER_ID` point at a bootstrapped org/user in this worktree's DB
(`repel orgs bootstrap` first if not).

```
bun run cli accounts add gmail --alias personal   # browser consent → prints { id, alias, externalAccountId }
bun run cli accounts show personal                 # decrypts + displays the stored credentials
bun run cli accounts add gmail --alias personal    # again → DuplicateProviderAccountError, no second row
```

## Common failures

- `redirect_uri_mismatch` → client is "Web application", not Desktop app. Recreate.
- `access_denied` / "app not verified" → not added as a test user, or consent
  screen not published.
- `Gmail API has not been used in project… or it is disabled` → step 2 skipped.
- Refresh token missing → only returned on first consent unless `prompt=consent`
  forces it; the code sets it, so re-running yields a fresh one.
