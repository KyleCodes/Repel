# Domain Review Checklist

- RLS: does every new table have a `tenant_isolation` policy and an `org_id` column? Does every runtime query go through `withOrgTx`?
- Transactions: are cross-domain writes wrapped in `withTx` / `withOrgTx`? No service calls `getDb().transaction()` directly.
- Repo boundary: do repos return row types only? Do services map to domain types via `mappers.ts` before returning?
- CamelCase: are new columns added as camelCase keys in `types.ts` and snake_case in SQL migrations?
- Credentials: are credentials never logged, never returned from the service layer, always stored via `credentialsEncrypted` Buffer?
- Job queue: are jobs enqueued in the same transaction as the triggering insert? Are dequeue operations using `SKIP LOCKED`?
