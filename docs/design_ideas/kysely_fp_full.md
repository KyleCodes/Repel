# Kysely FP Architecture (Function Syntax Version)

This document contains a full example of a TypeScript + Kysely backend using:

- Functional style (no classes)
- Vertical domain structure
- Clean transaction handling via `withTx`
- Process-level DB singleton (no request-level DI)

All examples use **function syntax**, not arrow functions.

---

## Core Principles

- Repos are factory functions bound to a DB executor (`db | trx`)
- Services orchestrate repos
- Transactions are owned by cross-cutting services
- Services depend on a **transaction capability**, not raw DB
- Domain types are separate from DB row types
- No classes

---

## File Structure

```
src/
  db/
    client.ts
    runtime.ts
    types.ts
    repos.ts
    tx.ts
    migrations/
  domains/
    org/
    user/
    providers/
    account-setup/
  api/
  cli.ts
  main.ts
```

---

# 1. DB Layer

## types.ts

```ts
import type { Kysely, Transaction, Generated, Selectable, Insertable } from "kysely"

export interface OrgsTable {
  id: Generated<string>
  name: string
  created_at: Generated<Date>
}

export interface UsersTable {
  id: Generated<string>
  org_id: string
  email: string
  full_name: string
  created_at: Generated<Date>
}

export interface ProviderAccountsTable {
  id: Generated<string>
  org_id: string
  user_id: string
  provider: string
  external_account_id: string
  created_at: Generated<Date>
}

export interface Database {
  orgs: OrgsTable
  users: UsersTable
  provider_accounts: ProviderAccountsTable
}

export type Db = Kysely<Database>
export type Tx = Transaction<Database>
export type DbExecutor = Db | Tx

export type OrgRow = Selectable<OrgsTable>
export type UserRow = Selectable<UsersTable>
export type ProviderAccountRow = Selectable<ProviderAccountsTable>
```

---

## client.ts

```ts
import { Kysely, PostgresDialect, CamelCasePlugin } from "kysely"
import { Pool } from "pg"
import type { Database } from "./types"

export function makeDb(): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: process.env.DATABASE_URL,
      }),
    }),
    plugins: [new CamelCasePlugin()],
  })
}
```

---

## runtime.ts (singleton)

```ts
import { makeDb } from "./client"

export const db = makeDb()
```

---

## repos.ts

```ts
import type { DbExecutor } from "./types"
import { makeOrgRepo } from "../domains/org/repo"
import { makeUserRepo } from "../domains/user/repo"
import { makeProviderRepo } from "../domains/providers/repo"

export function makeRepos(q: DbExecutor) {
  return {
    orgs: makeOrgRepo(q),
    users: makeUserRepo(q),
    providers: makeProviderRepo(q),
  }
}

export type Repos = ReturnType<typeof makeRepos>
```

---

## tx.ts (transaction capability)

```ts
import { db } from "./runtime"
import { makeRepos, type Repos } from "./repos"

export type WithTx = <T>(fn: (repos: Repos) => Promise<T>) => Promise<T>

export const withTx: WithTx = async function (fn) {
  return db.transaction().execute(function (trx) {
    return fn(makeRepos(trx))
  })
}
```

---

# 2. Domain: Org

## types.ts

```ts
export interface Org {
  id: string
  name: string
  createdAt: Date
}

export interface CreateOrgInput {
  name: string
}
```

---

## repo.ts

```ts
import type { DbExecutor, OrgRow } from "../../db/types"
import type { Org, CreateOrgInput } from "./types"

function mapOrg(row: OrgRow): Org {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
  }
}

export function makeOrgRepo(q: DbExecutor) {
  return {
    async create(input: CreateOrgInput): Promise<Org> {
      const row = await q
        .insertInto("orgs")
        .values({ name: input.name })
        .returningAll()
        .executeTakeFirstOrThrow()

      return mapOrg(row)
    },
  }
}
```

---

## service.ts

```ts
import type { Repos } from "../../db/repos"
import type { CreateOrgInput } from "./types"

export function makeOrgService(repos: Repos) {
  return {
    async createOrg(input: CreateOrgInput) {
      return repos.orgs.create(input)
    },
  }
}
```

---

# 3. Domain: User

## types.ts

```ts
export interface User {
  id: string
  orgId: string
  email: string
  fullName: string
  createdAt: Date
}

export interface CreateUserInput {
  orgId: string
  email: string
  fullName: string
}
```

---

## repo.ts

```ts
import type { DbExecutor, UserRow } from "../../db/types"
import type { User, CreateUserInput } from "./types"

function mapUser(row: UserRow): User {
  return {
    id: row.id,
    orgId: row.orgId,
    email: row.email,
    fullName: row.fullName,
    createdAt: row.createdAt,
  }
}

export function makeUserRepo(q: DbExecutor) {
  return {
    async create(input: CreateUserInput): Promise<User> {
      const row = await q
        .insertInto("users")
        .values(input)
        .returningAll()
        .executeTakeFirstOrThrow()

      return mapUser(row)
    },
  }
}
```

---

## service.ts

```ts
import type { Repos } from "../../db/repos"
import type { CreateUserInput } from "./types"

export function makeUserService(repos: Repos) {
  return {
    async createUser(input: CreateUserInput) {
      return repos.users.create(input)
    },
  }
}
```

---

# 4. Domain: Providers

## repo.ts

```ts
import type { DbExecutor, ProviderAccountRow } from "../../db/types"

export function makeProviderRepo(q: DbExecutor) {
  return {
    async createLinkedAccount(input) {
      const row = await q
        .insertInto("providerAccounts")
        .values(input)
        .returningAll()
        .executeTakeFirstOrThrow()

      return row
    },
  }
}
```

---

## service.ts

```ts
import type { Repos } from "../../db/repos"

export function makeProviderService(repos: Repos) {
  return {
    async linkProvider(input) {
      return repos.providers.createLinkedAccount(input)
    },
  }
}
```

---

# 5. Cross-Cutting: Account Setup

```ts
import type { WithTx } from "../../db/tx"
import { makeOrgService } from "../org/service"
import { makeUserService } from "../user/service"
import { makeProviderService } from "../providers/service"

export function makeAccountSetupService(params: { withTx: WithTx }) {
  const withTx = params.withTx

  return {
    async bootstrapAccount(input) {
      return withTx(async function (repos) {
        const orgService = makeOrgService(repos)
        const userService = makeUserService(repos)
        const providerService = makeProviderService(repos)

        const org = await orgService.createOrg({ name: input.orgName })

        const user = await userService.createUser({
          orgId: org.id,
          email: input.userEmail,
          fullName: input.userFullName,
        })

        const providerAccount = await providerService.linkProvider({
          orgId: org.id,
          userId: user.id,
          provider: input.provider,
          externalAccountId: input.externalAccountId,
        })

        return { org, user, providerAccount }
      })
    },
  }
}
```

---

# 6. App Composition

```ts
import { db } from "./db/runtime"
import { makeRepos } from "./db/repos"
import { withTx } from "./db/tx"
import { makeUserService } from "./domains/user/service"
import { makeAccountSetupService } from "./domains/account-setup/service"

const repos = makeRepos(db)

export const userService = makeUserService(repos)

export const accountSetupService = makeAccountSetupService({
  withTx,
})
```

---

# Summary

This pattern:

- avoids DI ceremony
- avoids global DB coupling
- keeps transactions explicit
- keeps services clean
- keeps infra swappable

