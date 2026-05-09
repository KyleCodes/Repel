# Session Handoff: Decorator-Based Transactions & `core/acme/` Reference Vertical — REP-9 Plan Landed

**Date:** 2026-04-18
**Session Duration:** ~2 days of design + one full implementation session in the template + ADR/ticket landing pass
**Session Focus:** Replace caller-owned `withTx`/`withOrgTx` with a decorator-based transaction-ownership model, validate end-to-end in `~/Developer/monorepo_template`, then amend Repel's ADR-009 + ADR-010 and expand REP-9 scope to carry the migration plus a `core/acme/` reference vertical. No Repel code changed — design is locked, mechanical port is what remains.
**Context Usage at Handoff:** ~90%

---

## TL;DR for a fresh engineer

You are implementing **REP-9**. Its scope just grew. It is no longer a directory rename — it now ports a **fully designed and validated** new transaction-ownership model from `~/Developer/monorepo_template` into Repel. The design has been proven end-to-end in the template (full stack boots, 26 tests pass, RLS verified cross-tenant). There is **no design work left** — just port the shape verbatim and add `core/acme/` as a reference vertical.

Read in this order before touching code:

1. This handoff (you are here)
2. `/Users/kylemuldoon/Developer/Repel/docs/context/adr/ADR-009-vertical-domain-layout-repo-factories.md` — amended 2026-04-18 (see Amendments section)
3. `/Users/kylemuldoon/Developer/Repel/docs/context/adr/ADR-010-transaction-boundaries-withtx-withOrgtx.md` — fully rewritten 2026-04-18
4. `/Users/kylemuldoon/Developer/monorepo_template/apps/server/src/db/tx.ts` — **the primitive to port verbatim**
5. REP-9 Linear ticket (retitled, scope expanded, full acceptance criteria)

---

## Why this exists

The 2026-04-13 ADR-010 had transport layers (HTTP, GraphQL, CLI) import `withOrgTx` and construct services per-request:

```ts
// Old shape. Dead. Do not port this.
app.post('/api/todos', async (req, res) => {
  const todo = await withOrgTx(req.orgId, async (repos) => {
    const userService = makeUserService(repos);
    const todoService = makeTodoService(repos);
    return todoService.createTodo({...});
  });
});
```

Two problems, identified in conversation 2026-04-17:

1. **Leaky abstraction.** Transport is transaction-aware. It imports tx primitives, constructs services, owns the boundary. It shouldn't.
2. **Composition friction.** Cross-service atomic flows (like `account-setup.bootstrap`) had to thread `withTx` into factories or duplicate repo calls. `_inTx` dual surfaces were considered and rejected as too verbose.

Final shape, locked in after iteration:

```ts
// New shape. This is what REP-9 delivers.
app.post('/api/todos', async (req, res) => {
  const todo = await todoService.createTodo({ orgId: req.orgId, ...body });
  res.status(201).json(todo);
});
```

Services are module-level singletons. Methods are wrapped in `runInOrgTx(...)` (or `runInTx(...)` for bootstrap). AsyncLocalStorage carries the transaction context down the async call graph — nested decorated calls join the ambient tx instead of opening a fresh one.

---

## The kernel idea: `runInOrgTx` is a **decorator**, not a function services call internally

```ts
// core/org/service.ts (what you will write in REP-9)
export const orgService = {
  getOrgById: runInOrgTx(async function (
    repos,
    input: { orgId: string }
  ): Promise<Org> {
    const row = await repos.orgs.findById(input.orgId);
    if (!row) throw new Error(`Org ${input.orgId} not found`);
    return orgRowToOrg(row);
  }),
};
```

Call site:

```ts
const org = await orgService.getOrgById({ orgId: 'abc' }); // opens a tx, SET LOCAL, returns
```

Nested call from another decorated method:

```ts
createTodo: runInOrgTx(async function (repos, input) {
  const user = await userService.getUserById({ orgId: input.orgId, id: input.userId });
  // ↑ userService.getUserById is also decorated. It sees an ambient tx via ALS
  // and joins it — does NOT open a new transaction. Same `repos`, same SET LOCAL.
  const row = await repos.todos.insert({ ... });
  return todoRowToTodo(row);
})
```

**Key invariant**: the `repos` argument inside a decorated method is the transaction-scoped `Repos` bundle. You can freely call it directly OR call another decorated service — both run in the same tx.

---

## The three guard rails (runtime + compile-time)

1. **Compile-time** (`OrgScoped<A>` type): every tenant-scoped service method input MUST be either a bare `orgId` string or an object with a required `orgId: string` field. The decorator's type constraint won't let you define one otherwise.

2. **Cross-tenant runtime guard**: if method A is decorated for org X and internally calls method B with org Y, the decorator throws. No silent cross-tenant writes.

3. **RLS-bypass runtime guard**: if a tenant-scoped `runInOrgTx` method is called from inside a `runInTx` (unscoped) ambient transaction, it throws. Bootstrap cannot accidentally call into tenant code without `SET LOCAL app.current_org_id`.

All three are covered by tests in the template — port them.

---

## The `*Impl` export convention (when and why)

Tenant-scoped `runInOrgTx` services refuse to join a `runInTx` ambient (would bypass RLS). But bootstrap **is** a `runInTx` flow and **does** need to create an org and user atomically. How?

**Answer**: sibling `*Impl` exports. The undecorated inner function is exported under `xServiceImpl`. Cross-service flow composition reaches for those instead of the decorated versions.

```ts
// core/org/service.ts
async function createOrgImpl(repos: Repos, input: CreateOrgInput): Promise<Org> {
  const row = await repos.orgs.insert({ name: input.name });
  return orgRowToOrg(row);
}

export const orgService = {
  createOrg: runInTx(createOrgImpl),     // public API — opens its own runInTx
  getOrgById: runInOrgTx(async function (repos, input: { orgId: string }) { ... }),
};

export const orgServiceImpl = {
  createOrg: createOrgImpl,              // for composition inside other runInTx flows
};
```

```ts
// core/account-setup/service.ts
async function bootstrapImpl(repos: Repos, input: BootstrapInput): Promise<BootstrapResult> {
  const existing = await repos.users.findByEmail(input.userEmail);  // direct repo call (unscoped)
  if (existing) throw new Error('already bootstrapped');
  const org = await orgServiceImpl.createOrg(repos, { name: input.orgName });   // compose via *Impl
  const user = await userServiceImpl.createUser(repos, { orgId: org.id, ... });
  return { org, user };
}

export const accountSetupService = {
  bootstrap: runInTx(bootstrapImpl),
};
```

**Rule of thumb**: only lift a named `*Impl` when another flow service needs to compose it. Default is inline lambdas inside the `xService` object. The template's `core/todo/service.ts` is a full example of the inline-only style (nothing composes it via `runInTx`).

---

## What changed this session

### Repel — documentation only (code unchanged)

| File                                                                  | Action          | What                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/context/adr/ADR-009-vertical-domain-layout-repo-factories.md`   | Amended         | Added 2026-04-18 amendment section. Updated Compliance to require module-level singleton services + `OrgScoped<A>` input constraint + `*Impl` SHOULD. Updated "Positive" testability note.                                             |
| `docs/context/adr/ADR-010-transaction-boundaries-withtx-withOrgtx.md` | Fully rewritten | Retitled to "Transaction Ownership via runInOrgTx/runInTx Decorators". New Decision section, 7-row risk/mitigation table, expanded Alternatives Considered, full Compliance block. 2026-04-13 original preserved in a History section. |
| `docs/summaries/handoff-2026-04-18-REP-9-plan.md`                     | Created         | This document.                                                                                                                                                                                                                         |

### Repel Linear tickets — updated via Linear MCP

| Ticket     | Change                                                                                                                                                                                                                                         |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **REP-9**  | **Retitled** to "Rename domains/ → core/, adopt runInOrgTx decorator, land core/acme reference". Scope expanded to include `db/tx.ts` rewrite + service flattening + `core/acme/` reference vertical. Full acceptance criteria with grep gate. |
| **REP-8**  | Added `acme` table to the v0 migration scope. Shape: `id uuid PK, org_id uuid FK, note text, created_at, updated_at` + RLS. Documented as reference-only.                                                                                      |
| **REP-7**  | Parent body updated to note the decorator-model scope landing in REP-9. Project milestone descriptions updated.                                                                                                                                |
| **REP-10** | Service contract updated: module-level singletons, `createOrg`/`createUser` as `runInTx` with `*Impl`, `orgId` inputs.                                                                                                                         |
| **REP-11** | Service contract updated (same pattern — `providerAccountService` singleton, `runInOrgTx` methods, `orgId` inputs). `*Impl` guidance added.                                                                                                    |
| **REP-12** | Service contract updated. Note added that `insertMessageWithRaw` atomicity comes from the `runInOrgTx` decorator, not caller-threaded `withOrgTx`.                                                                                             |
| **REP-32** | Comment added: dev-db is unaffected by the decorator refactor; peer-directory landing (e.g. `apps/server/src/dev/db/`) confirmed via template precedent.                                                                                       |

### Template (completed last session — reference only)

Already done. Working end-to-end. **This is your canonical reference.**

| File                                                                                          | State                                                                                                                                         |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `~/Developer/monorepo_template/apps/server/src/db/tx.ts`                                      | **Port this verbatim.** 100 lines, self-contained, no Repel-specific code.                                                                    |
| `~/Developer/monorepo_template/apps/server/src/db/repos.ts`                                   | Pattern for `makeRepos(q)` bundle.                                                                                                            |
| `~/Developer/monorepo_template/apps/server/src/core/{org,user,todo,account-setup}/service.ts` | Service shape reference. `todo` = fully inline. `org`+`user` = `*Impl` lifted for `createOrg`/`createUser`. `account-setup` = `runInTx` flow. |
| `~/Developer/monorepo_template/apps/server/src/db/__tests__/tx.test.ts`                       | **Port these 6 tests.** Cover all three guards + happy paths. No DB required — uses `withTxContext` helper.                                   |
| `~/Developer/monorepo_template/docs/context/adr/ADR-008-...md`, `ADR-009-...md`               | Template's version of the two ADRs. Repel's ADR-009 amendment + ADR-010 rewrite mirror these.                                                 |

---

## What REP-9 must deliver (health gates)

From the amended ticket, verbatim:

- [ ] `apps/server/src/domains/` no longer exists
- [ ] `apps/server/src/core/{org,user,account-setup,acme}/` exist and compile
- [ ] `apps/server/src/db/tx.ts` exports `runInOrgTx`, `runInTx`, `withTxContext`, `OrgScoped<A>`, `TxContext`. Old `withTx`/`withOrgTx` exports removed.
- [ ] Every `core/*/service.ts` is a module-level singleton (`export const xService = { ... }`). No `makeXService(repos)` factories anywhere.
- [ ] `core/account-setup/service.ts` is `runInTx`-wrapped and composes via `orgServiceImpl.createOrg` + `userServiceImpl.createUser`.
- [ ] Every tenant-scoped service method input has an `orgId` field (compile-time enforced by `OrgScoped<A>`).
- [ ] `core/acme/` exists, wired into `db/repos.ts`, with all four files + header comment identifying it as the reference vertical. `acme` table + RLS policy lives in a migration.
- [ ] `apps/server/src/db/repos.ts` references `core/` paths and includes `acme` in the bundle.
- [ ] `grep -rE 'withOrgTx|withTx\b|makeRepos\b|make[A-Z][a-zA-Z]+Service' apps/server/src/{api,core/**/cli.ts,main.ts,cli.ts}` returns **zero** matches.
- [ ] `bun run typecheck` clean.
- [ ] `bun test` passes — existing tests + new tx guard tests in `db/__tests__/tx.test.ts`.
- [ ] `bun run cli bootstrap --org-name "…" --email "…"` succeeds against a migrated branch DB (CLI round-trip end-to-end).
- [ ] `docs/03-sql-schema.md`, `docs/04-application-architecture.md` updated; ADR-009 amendment + ADR-010 rewrite land in the same commit.
- [ ] REP-5 closed as duplicate.

---

## Concrete step-by-step for REP-9 execution

1. **Branch**: the ticket already has `kylemuldoon15/rep-9-rename-domains-core-adopt-runinorgtx-decorator-land-coreacme`. Work there.

2. **Port `db/tx.ts`**: copy `~/Developer/monorepo_template/apps/server/src/db/tx.ts` to `/Users/kylemuldoon/Developer/Repel/apps/server/src/db/tx.ts`. No edits needed — it's Repel-agnostic. Removes `withTx`/`withOrgTx`; adds `runInTx`/`runInOrgTx`/`withTxContext`/`OrgScoped<A>`/`TxContext`.

3. **Move `domains/` → `core/`**: mechanical file move. Delete `domains/providers/` (scaffold). `account-setup/`, `org/`, `user/` become `core/account-setup/`, `core/org/`, `core/user/`.

4. **Flatten services** (follow template's `core/org/service.ts` + `core/user/service.ts` exactly):
   - `core/org/service.ts`: `export const orgService`. `createOrg` → lifted `createOrgImpl`, wrapped with `runInTx`. `getOrgById({ orgId })` → inline `runInOrgTx` lambda. Export `orgServiceImpl = { createOrg: createOrgImpl }`.
   - `core/user/service.ts`: same pattern. Lift `createUserImpl` (`runInTx`). `getUserById({ orgId, id })`, `listUsersInOrg({ orgId })` → inline `runInOrgTx` lambdas. Export `userServiceImpl = { createUser: createUserImpl }`.
     - Drop `getUserByEmail` from the public surface — it's cross-org by nature and doesn't fit the tenant-scoped model. Bootstrap calls `repos.users.findByEmail` directly instead.
   - `core/account-setup/service.ts`: `export const accountSetupService = { bootstrap: runInTx(bootstrapImpl) }`. Inside `bootstrapImpl(repos, input)`:
     - `repos.users.findByEmail(input.userEmail)` — direct repo call for the duplicate check (no tenant service available in `runInTx`)
     - `orgServiceImpl.createOrg(repos, { name })` — compose
     - `userServiceImpl.createUser(repos, { orgId: org.id, email, name, role: 'admin' })` — compose

5. **Update `db/repos.ts`**: add `acme: makeAcmeRepo(q)`.

6. **Update `db/types.ts`**: add `AcmeRow`, `NewAcme`, `AcmeUpdate` interfaces matching the schema.

7. **Add `core/acme/`**: copy shape from `~/Developer/monorepo_template/apps/server/src/core/todo/` and adapt. Four files:
   - `repo.ts` — `makeAcmeRepo(q: DbExecutor)` with `insert`, `findById`, `listForOrg`, `deleteById`
   - `service.ts` — `export const acmeService = { ... }`. All methods inline `runInOrgTx` lambdas (no `*Impl` — nothing composes it). **Include a header comment**: _"Reference vertical — demonstrates the canonical shape of a tenant-scoped bounded context. Has no dependents. Delete when a new vertical in this repo is well-exercised as the reference."_
   - `types.ts` — `Acme`, `CreateAcmeInput`, etc.
   - `mappers.ts` — `acmeRowToAcme`

8. **Migration**: add `acme` table + RLS policy. If REP-8's v0 migration hasn't merged yet, add to v0 (preferred). Otherwise land as a follow-on migration in the same PR.

9. **Update `apps/server/src/cli.ts`** and `core/account-setup/cli.ts`: remove `withTx` imports, `makeAccountSetupService` factory calls. Call `accountSetupService.bootstrap(...)` directly. See template's `apps/server/src/core/account-setup/cli.ts`.

10. **Port tx tests**: copy `~/Developer/monorepo_template/apps/server/src/db/__tests__/tx.test.ts` to Repel. No DB required — uses the `withTxContext` helper. 6 test cases.

11. **Run the grep gate**:

    ```bash
    grep -rE 'withOrgTx|withTx\b|makeRepos\b|make[A-Z][a-zA-Z]+Service' apps/server/src/{api,core/**/cli.ts,main.ts,cli.ts}
    ```

    Must return zero matches. If it hits, the refactor isn't complete.

12. **Smoke test**:

    ```bash
    bun run typecheck                                              # clean
    bun test                                                        # all pass
    docker compose --profile dev up -d                              # if not running
    bun run cli db refresh-template && bun run cli db clone main    # via REP-32 CLI
    cd apps/server && DATABASE_URL=... bunx node-pg-migrate up --migrations-dir src/db/migrations
    bun run cli bootstrap --org-name "Test" --email test@example.com    # CLI round-trip
    ```

13. **Close REP-5** as duplicate of REP-9 (already marked Duplicate but confirm it's linked).

14. **Commit**: one commit per the Repel repo convention (see `CLAUDE.md`). Message body should reference ADR-009 amendment + ADR-010 rewrite.

---

## Decisions Made This Session

- **DECISION**: Replace caller-owned `withTx`/`withOrgTx` with `runInOrgTx`/`runInTx` decorators wrapped at service definition. BECAUSE transport layers are transaction-aware only leaks abstraction; services owning their transaction cleanly solves both the leaky-abstraction and composition-friction problems. CONFIRMED via template end-to-end validation.

- **DECISION**: AsyncLocalStorage is the composition mechanism. BECAUSE it's the only approach that gives one surface per service method AND implicit tx-joining AND preserves atomicity without manual plumbing. The `_inTx` dual-surface alternative was explicitly rejected as too verbose. CONFIRMED — working in template.

- **DECISION**: Every tenant-scoped method input takes `{ orgId, ... }` (or bare orgId string). BECAUSE the decorator needs to extract `orgId` for `SET LOCAL app.current_org_id`, AND making tenancy loud in signatures is a feature. Enforced at compile time via `OrgScoped<A>` type constraint. CONFIRMED.

- **DECISION**: `*Impl` exports are opt-in per method. Only lift when another flow service composes it inside `runInTx`. Default is inline lambdas in the `xService` object. BECAUSE most methods don't need composition and lifting every method doubles the file size for no benefit. CONFIRMED via template (`core/todo/service.ts` has zero `*Impl`; `core/{org,user}` have `*Impl` only for `createOrg`/`createUser`).

- **DECISION**: Land the refactor as part of REP-9 rather than opening a new ticket. BECAUSE REP-9 already touches every service file for the directory rename — bundling the shape change is one atomic transformation instead of two. CONFIRMED by user.

- **DECISION**: Add `core/acme/` as a living reference vertical inside Repel. BECAUSE a specimen-in-repo saves future engineers from cross-repo reference digging. Mirrors the template's `core/todo/` exactly, with an explicit header comment marking it as reference-only. Gets deleted in a future ticket when a real Repel vertical has been in-tree long enough to be the reference. CONFIRMED by user.

- **DECISION**: `core/acme/` inline-only (no `*Impl`), matching `core/todo/`. BECAUSE nothing composes it via `runInTx`; the demonstration value is in the decorator pattern itself, not the `*Impl` convention (which is illustrated by `core/org` + `core/user`).

- **DECISION**: `dev-db/` does NOT move under `core/`. BECAUSE ADR-009 reserves `core/` for tenant-scoped business entities. `dev-db/` is dev-only infra. Peer directory (e.g. `apps/server/src/dev/db/`). Template uses this exact location and validates it. CONFIRMED; REP-32 comment added.

---

## Key Numbers & Validation

- **Template tests**: 26 passing, 0 failing (with `TEST_DATABASE_URL` exported). 10 new tests added across `db/__tests__/tx.test.ts`, `core/todo/__tests__/service.test.ts`, `core/account-setup/__tests__/service.test.ts`.
- **Template grep gate**: `grep -rE 'withOrgTx|withTx\b|makeRepos\b|make[A-Z][a-zA-Z]+Service' apps/server/src/{api,core/*/cli.ts,worker.ts,main.ts,cli.ts}` returns zero matches.
- **Template typecheck**: clean.
- **Template full-stack smoke**: CLI bootstrap + `todo add/list/done` + HTTP `GET/POST/PATCH/DELETE /api/todos` + cross-tenant RLS verification (org B query returns empty for org A data). All working.
- **ALS overhead**: ~100–200ns per `.run()` call. Negligible.
- **CLI exit time**: ~100ms after adding `closeDb()` call to `cli.ts` (was 10s before — pool wasn't closed). If you notice this when porting `cli.ts`, carry the fix.

---

## Conditional Logic Established

- **IF** a service method is tenant-scoped **THEN** wrap in `runInOrgTx` and its input must include `orgId`. BECAUSE `OrgScoped<A>` compile-time constraint + `SET LOCAL app.current_org_id` runtime requirement.

- **IF** a service method creates the org itself (bootstrap) **THEN** wrap in `runInTx`, not `runInOrgTx`. BECAUSE no `orgId` exists to scope by; must run under superuser/BYPASSRLS role.

- **IF** a flow service needs to compose multiple tenant-scoped operations atomically inside `runInTx` **THEN** call the sibling `*Impl` exports of downstream services (passing `repos` directly), NOT the decorated versions. BECAUSE decorated tenant-scoped methods throw when called inside a `runInTx` ambient (RLS-bypass guard).

- **IF** a method is trivial (1:1 repo call) and has no second caller **THEN** inline it as a lambda inside the `xService` object. BECAUSE lifting named `*Impl` for no reason doubles line count and obscures the service's actual surface.

- **IF** two decorated methods call each other with the same `orgId` **THEN** the nested call joins the ambient tx automatically (via AsyncLocalStorage). BECAUSE that's the core mechanism — no plumbing required.

- **IF** two decorated methods are called with different `orgId`s inside the same async context **THEN** the second call throws (cross-tenant guard). BECAUSE we refuse to silently switch tenancy inside one transaction.

- **EXCEPT** a legitimate cross-tenant admin flow appears (e.g. super-admin dashboard). In that case, open a new ticket for a `runAsAdmin` primitive. Do NOT relax the cross-tenant guard.

- **IF** REP-8's v0 migration has already merged by the time REP-9 executes **THEN** add `acme` table as a follow-on migration in the same PR, not to v0. OTHERWISE add to v0 directly.

---

## Files Created or Modified (this session)

| File Path                                                                                                | Action          | Description                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/Users/kylemuldoon/Developer/Repel/docs/context/adr/ADR-009-vertical-domain-layout-repo-factories.md`   | Amended         | Added 2026-04-18 Amendment section. Updated Compliance (singleton services, `OrgScoped<A>`, `*Impl` SHOULD). Updated "Positive" testability note. |
| `/Users/kylemuldoon/Developer/Repel/docs/context/adr/ADR-010-transaction-boundaries-withtx-withOrgtx.md` | Fully rewritten | Retitled. New Decision section, 7-row risk/mitigation table, History preserving 2026-04-13 original.                                              |
| `/Users/kylemuldoon/Developer/Repel/docs/summaries/handoff-2026-04-18-REP-9-plan.md`                     | Created         | This document.                                                                                                                                    |
| Linear REP-9                                                                                             | Updated         | Retitled, scope expanded, full AC.                                                                                                                |
| Linear REP-8                                                                                             | Updated         | Added `acme` table to v0 migration scope.                                                                                                         |
| Linear REP-7                                                                                             | Updated         | Parent body notes decorator-model scope in REP-9.                                                                                                 |
| Linear REP-10                                                                                            | Updated         | Service contract → singletons + `runInOrgTx` + `*Impl` convention.                                                                                |
| Linear REP-11                                                                                            | Updated         | Same contract update.                                                                                                                             |
| Linear REP-12                                                                                            | Updated         | Same, plus note on `insertMessageWithRaw` atomicity via decorator.                                                                                |
| Linear REP-32                                                                                            | Comment         | Confirmed dev-db unaffected; peer-directory landing via template precedent.                                                                       |

**Template files** (already landed last session; untouched this session but are your reference material):

- `~/Developer/monorepo_template/apps/server/src/db/tx.ts`
- `~/Developer/monorepo_template/apps/server/src/db/repos.ts`
- `~/Developer/monorepo_template/apps/server/src/core/{org,user,todo,account-setup}/service.ts`
- `~/Developer/monorepo_template/apps/server/src/core/todo/cli.ts`
- `~/Developer/monorepo_template/apps/server/src/core/account-setup/cli.ts`
- `~/Developer/monorepo_template/apps/server/src/api/rest/routes/todos.ts`
- `~/Developer/monorepo_template/apps/server/src/db/__tests__/tx.test.ts`
- `~/Developer/monorepo_template/apps/server/src/core/todo/__tests__/service.test.ts`
- `~/Developer/monorepo_template/apps/server/src/core/account-setup/__tests__/service.test.ts`
- `~/Developer/monorepo_template/docs/context/adr/ADR-008-vertical-core-layout-repo-factories.md`
- `~/Developer/monorepo_template/docs/context/adr/ADR-009-transaction-boundaries-withtx-withOrgtx.md`

---

## What the NEXT Session Should Do

1. **First**: Read `/Users/kylemuldoon/Developer/Repel/docs/context/adr/ADR-009-vertical-domain-layout-repo-factories.md` (2026-04-18 amendment) and `ADR-010-transaction-boundaries-withtx-withOrgtx.md` (2026-04-18 rewrite). These are the contracts. If anything doesn't make sense after reading these + this handoff, stop and ask before coding.

2. **Then**: Open `~/Developer/monorepo_template/apps/server/src/db/tx.ts` and read it end-to-end. That is the single most important file to understand. It's ~100 lines. Understand each guard clause.

3. **Then**: Run the template's smoke test locally to see the decorator model working end-to-end:

   ```bash
   cd ~/Developer/monorepo_template
   bun run typecheck && bun test
   TEST_DATABASE_URL="postgres://acme:dev@localhost:5432/postgres" bun test
   ```

   If that passes, you've confirmed the baseline you're porting from is green.

4. **Then**: Execute REP-9 per the step-by-step above. One branch, one commit, all health gates green.

5. **Then**: Move REP-9 to Done. REP-5 closes automatically as duplicate.

6. **Out of scope for this session**: REP-10 / REP-11 / REP-12 implementations. Those inherit the contract set by REP-9. Assignee for those tickets picks them up separately once REP-9 lands.

---

## Open Questions Requiring User Input

- **OPEN:** Should REP-10 (core/org + core/user implementation against the real schema) be absorbed into REP-9's commit, or stay as a separate follow-on? REP-9 as currently scoped already flattens `core/org` + `core/user` services to singletons — which is 80% of REP-10's work. REP-10's remaining delta is "against the real schema" (post-REP-8 migration). If REP-8 lands first, REP-10 may collapse into REP-9. Needs a call at REP-9 execution time depending on REP-8 state.

- **OPEN:** `acme` table location — add to REP-8's v0 migration, or land as a follow-on migration inside REP-9's commit? Preference is v0 if REP-8 hasn't merged yet. Confirm with REP-8 assignee.

## Assumptions That Need Validation

- **ASSUMED:** REP-8's v0 migration has NOT yet landed as of REP-9 execution start. If it has, REP-9 adds a follow-on migration instead of editing v0. Validate by checking `apps/server/src/db/migrations/` for a v0 file at the start of REP-9 work.

- **ASSUMED:** `dev-db/` lands at `apps/server/src/dev/db/` (template location). REP-32's strand-3 open question is resolved this way. Validate by confirming the REP-32 assignee accepts this direction before REP-9 finalizes any `dev-db/` import paths.

- **ASSUMED:** `node-pg-migrate` in Repel behaves identically to the template (reads `DATABASE_URL` from env). If there's any Repel-specific migration harness difference, the smoke-test step in REP-9 may need adjustment.

---

## What NOT to Re-Read

- `~/Developer/Repel/apps/server/src/db/tx.ts` (current state) — will be entirely overwritten by REP-9. The template's version is the only one worth reading.
- The old 2026-04-13 ADR-010 content — preserved in the History section of the new ADR-010 for context, but the Decision has been replaced. Do not build mental model from the old shape.
- `~/Developer/Repel/apps/server/src/domains/providers/` — scaffold, being deleted in REP-9.

---

## Files to Load Next Session

- `/Users/kylemuldoon/Developer/Repel/docs/summaries/handoff-2026-04-18-REP-9-plan.md` — this handoff
- `/Users/kylemuldoon/Developer/Repel/docs/context/adr/ADR-009-vertical-domain-layout-repo-factories.md` — contract (amendment)
- `/Users/kylemuldoon/Developer/Repel/docs/context/adr/ADR-010-transaction-boundaries-withtx-withOrgtx.md` — contract (rewrite)
- `/Users/kylemuldoon/Developer/monorepo_template/apps/server/src/db/tx.ts` — canonical implementation (port verbatim)
- `/Users/kylemuldoon/Developer/monorepo_template/apps/server/src/core/org/service.ts` — `*Impl` lifting pattern
- `/Users/kylemuldoon/Developer/monorepo_template/apps/server/src/core/todo/service.ts` — inline-only pattern
- `/Users/kylemuldoon/Developer/monorepo_template/apps/server/src/core/account-setup/service.ts` — `runInTx` flow composition
- `/Users/kylemuldoon/Developer/monorepo_template/apps/server/src/db/__tests__/tx.test.ts` — guard tests to port
- Linear ticket REP-9 — execution scope + acceptance criteria
- Linear tickets REP-8, REP-10, REP-11, REP-12 — for downstream context (especially whether REP-8 has landed)

---

## Confirm with the user before starting

Before any code edits, confirm with Kyle:

1. Is REP-8's v0 migration landed or not? (Determines `acme` table location.)
2. Is REP-10 folded into REP-9's commit or staying separate?
3. Any Repel-specific context that makes the template's shape unusable as-is (unlikely, but worth asking)?

If answers are "v0 not landed, fold REP-10, no objections" — proceed with the full port. Otherwise adjust scope per the answers.
