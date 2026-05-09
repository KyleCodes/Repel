# Code Conventions

## Lib Directories

A `lib/` directory contains pure utility functions scoped to its parent domain. Each file is descriptively named for what it contains — no `utils.ts`, no `helpers.ts`.

Colocate libs at the narrowest scope possible. If a function is only used within `channels/gmail/`, it lives in `channels/gmail/lib/`. If it's used by both `gmail/` and `icloud/`, it moves to `channels/lib/`. Top-level `src/lib/` is reserved for genuinely cross-cutting concerns (crypto, contact resolution).

When a lib function is used by a new dependent outside its current scope, move it to the lowest common ancestor directory between all dependents.

### Examples

- `channels/lib/threading.ts` — thread resolution from email headers, used by both Gmail and iCloud adapters.
- `channels/gmail/lib/history.ts` — Gmail history API helpers, used only by Gmail ingress.
- `api/lib/filters.ts` — query param to SQL WHERE builders, used by multiple route files within `api/`.
- `pipeline/lib/retry.ts` — backoff/retry logic, used only within the pipeline.
- `src/lib/crypto.ts` — encrypt/decrypt, used by channels (credential decryption) and potentially API (if exposing credential management).

## Function Design

Prefer pure functions with deterministic outputs: arguments in, return value out.

Avoid side effects, global state, and ambient imports where possible. When side effects are unavoidable (database queries, network requests, filesystem writes), isolate them in boundary modules (`pool.ts`, `ingress.ts`, `worker.ts`) and keep the logic that decides _what_ to do separate from the code that _does_ it.

Functions that depend on external configuration (env vars, feature flags) receive it as an argument, not by reading `process.env` directly. The entrypoint (`main.ts`, `cli.ts`) reads the environment and passes values down.

Return values: return data from functions. Use exceptions for failures. Don't return `{ success: boolean, data?, error? }` union types — throw and let the caller handle it.

## Dependency Injection

All components receive their dependencies as function arguments. No singletons, no service locators, no DI containers.

```typescript
// yes
function createWorker(db: Pool, config: WorkerConfig): Worker { ... }

// no
const db = getPool(); // singleton
class Worker { constructor() { this.db = Container.resolve('db'); } }
```

The entrypoint is the composition root — it creates the pool, reads config from env, and wires everything together.

## File Organization

- `src/main.ts` — server entrypoint, mode selection, composition root.
- `src/cli.ts` — CLI entrypoint, same composition pattern.
- `src/commands/` — CLI command implementations. One file per command, one exported function per file.
- `src/db/migrations/` — raw SQL migration files, applied in filename order.
- Domain directories (`channels/`, `pipeline/`, `agent/`, `api/`) contain their own `lib/` subdirectories.

## Testing

Tests live in `__tests__/` directories colocated with their implementation:

```
src/
  channels/
    lib/
      threading.ts
      __tests__/
        threading.test.ts
  pipeline/
    lib/
      retry.ts
      __tests__/
        retry.test.ts
```

Test files are named after what they test: `threading.test.ts` tests `threading.ts`.

Pure lib functions are tested by importing and asserting input → output. No mocking needed.

Side-effectful modules are tested with integration tests against a test database. Seed data goes in test fixtures, not factory functions with 15 optional parameters.

Commands with `--dry-run` are tested by invoking with `--dry-run` and asserting against expected output strings. Dry-run output is deterministic — no dependency on live system state.

## Naming

- Files: `kebab-case.ts`
- Functions: `camelCase`
- Types/Interfaces: `PascalCase`
- Constants: `SCREAMING_SNAKE_CASE` for true constants (config keys, enum-like values), `camelCase` for derived values
- Database columns: `snake_case`
- API routes: `kebab-case` paths, `camelCase` JSON keys

## Error Handling

Throw errors. Don't swallow them, don't return error codes, don't log-and-continue unless the operation is explicitly fire-and-forget (e.g., a background sync that should not crash the process).

The worker poll loop catches errors from individual job processing, logs them, marks the job as failed, and continues. This is the correct boundary for error recovery in background processing.

API route handlers use Express error middleware. Throw, and let the middleware translate to HTTP status codes.

## SQL

Raw SQL via `pg` driver. No ORM, no query builder. Parameterized queries for all user input.

Complex queries go in dedicated functions, not inline in route handlers:

```typescript
// yes — in a query module
function getMessagesByTag(
  db: Pool,
  orgId: string,
  tag: string
): Promise<Message[]> {
  return db.query(
    `SELECT ... FROM message JOIN message_tag ... WHERE org_id = $1 AND tag = $2`,
    [orgId, tag]
  );
}

// no — inline SQL in route handler
app.get('/messages', async (req, res) => {
  const result = await db.query(`SELECT ... long query ...`);
});
```

## Formatting and Linting

ESLint with a minimal config. Prettier for formatting. No bikeshedding — pick defaults and move on.

`tsconfig.json` with `strict: true`. No `any` unless interfacing with an untyped external dependency, and even then, type it at the boundary.
