import { AsyncLocalStorage } from 'node:async_hooks';
import { sql } from 'kysely';
import { type Repos, makeRepos } from './repos.ts';
import { getDb } from './runtime.ts';

// Runtime context tracked per transaction. runInOrgTx/runInTx stash this on
// the AsyncLocalStorage so nested service calls can detect an ambient tx
// and join it instead of opening a fresh one.
//
// orgId === null indicates a runInTx (no RLS scoping — bootstrap only).
export interface TxContext {
  repos: Repos;
  orgId: string | null;
}

const txStorage = new AsyncLocalStorage<TxContext>();

// Convention (ADR-009): every tenant-scoped service method's input must be
// either a bare orgId string or an object with a required `orgId: string`.
// This constraint fails at compile time when misused.
export type OrgScoped<A> = A extends string
  ? A
  : A extends { orgId: string }
    ? A
    : never;

function extractOrgId<A>(arg: OrgScoped<A>): string {
  return typeof arg === 'string' ? arg : (arg as { orgId: string }).orgId;
}

// Decorator for tenant-scoped service methods.
//   - No ambient tx → opens one, SET LOCAL app.current_org_id = <orgId>,
//     builds Repos, runs fn under the tx context.
//   - Ambient tx with same orgId → joins it; reuses repos; skips SET LOCAL.
//   - Ambient tx with a different orgId → throws (cross-tenant leak guard).
//   - Ambient runInTx (no org) → throws; cannot call tenant code from
//     unscoped flows because RLS would not be active.
export function runInOrgTx<A, R>(
  fn: (repos: Repos, input: OrgScoped<A>) => Promise<R>
): (input: OrgScoped<A>) => Promise<R> {
  return async function (input: OrgScoped<A>): Promise<R> {
    const orgId = extractOrgId(input);
    const ambient = txStorage.getStore();
    if (ambient) {
      if (ambient.orgId === null) {
        throw new Error(
          'runInOrgTx: cannot call tenant-scoped service inside runInTx ' +
            '(ambient transaction has no org context)'
        );
      }
      if (ambient.orgId !== orgId) {
        throw new Error(
          `runInOrgTx: ambient transaction scoped to org ${ambient.orgId}, ` +
            `refusing to join as ${orgId}`
        );
      }
      return fn(ambient.repos, input);
    }
    return getDb()
      .transaction()
      .execute(async function (trx) {
        await sql`SET LOCAL app.current_org_id = ${sql.lit(orgId)}`.execute(
          trx
        );
        const repos = makeRepos(trx);
        return txStorage.run({ repos, orgId }, function () {
          return fn(repos, input);
        });
      });
  };
}

// Decorator for unscoped flows — bootstrap, and other flows that create
// the org itself. Joins an ambient runInTx if one exists; refuses to join
// a runInOrgTx, which would silently bypass RLS.
export function runInTx<A, R>(
  fn: (repos: Repos, input: A) => Promise<R>
): (input: A) => Promise<R> {
  return async function (input: A): Promise<R> {
    const ambient = txStorage.getStore();
    if (ambient) {
      if (ambient.orgId !== null) {
        throw new Error(
          'runInTx: refusing to join an org-scoped ambient transaction ' +
            '(would bypass RLS)'
        );
      }
      return fn(ambient.repos, input);
    }
    return getDb()
      .transaction()
      .execute(async function (trx) {
        const repos = makeRepos(trx);
        return txStorage.run({ repos, orgId: null }, function () {
          return fn(repos, input);
        });
      });
  };
}

// Test-only helper. Runs `fn` with a pre-supplied TxContext on the ALS so
// services behave as if they joined an ambient tx. Use with a fake Repos
// for unit tests.
export function withTxContext<T>(
  ctx: TxContext,
  fn: () => Promise<T>
): Promise<T> {
  return txStorage.run(ctx, fn);
}
