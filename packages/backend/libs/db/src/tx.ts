import { AsyncLocalStorage } from 'node:async_hooks';
import { sql } from 'kysely';
import { normalizeDbError } from './error.ts';
import { getDb } from './runtime.ts';
import type { Tx } from './types.ts';

// Run a decorated operation, classifying any raw pg/Kysely error crossing the
// tx boundary into the AppError hierarchy (DBError family for genuine DB faults,
// existing AppErrors passed through). Applied on every fresh-open and ambient-
// join path so "what a service catches is always an AppError" holds app-wide.
async function withDbErrorClassification<R>(fn: () => Promise<R>): Promise<R> {
  try {
    return await fn();
  } catch (err) {
    throw normalizeDbError(err);
  }
}

// Runtime context tracked per transaction. runInOrgTx/runInTx stash this on
// the AsyncLocalStorage so nested service calls can detect an ambient tx
// and join it instead of opening a fresh one.
//
// orgId === null indicates a runInTx (no RLS scoping — bootstrap only).
//
// `trx` is the live Kysely transaction handle. Decorated service operations
// receive it as their first argument on both fresh-open and ambient-join
// paths, so a service operation never needs to know whether it is the root
// of a transaction or joining an ambient one — its first arg is always the
// right `trx` (decorator option (b) per manifesto §4 / §5).
export interface TxContext {
  trx: Tx;
  orgId: string | null;
}

const txStorage = new AsyncLocalStorage<TxContext>();

// Decorator for tenant-scoped service methods.
//
// The wrapper's public input type is `A & { orgId: string }` — the caller
// supplies `orgId` to scope the transaction, and the inner `fn` sees its
// own input type `A` (views and flows do not need to declare `orgId`;
// Postgres RLS handles tenant filtering once SET LOCAL is in place).
//
//   - No ambient tx → opens one, SET LOCAL app.current_org_id = <orgId>,
//     stashes { trx, orgId } on the ALS, runs fn(trx, input).
//   - Ambient tx with same orgId → joins it; passes ambient.trx to fn.
//   - Ambient tx with a different orgId → throws (cross-tenant leak guard).
//   - Ambient runInTx (no org) → throws; cannot call tenant code from
//     unscoped flows because RLS would not be active.
export function runInOrgTx<A, R>(
  fn: (trx: Tx, input: A) => Promise<R>
): (input: A & { orgId: string }) => Promise<R> {
  return async function (input: A & { orgId: string }): Promise<R> {
    const orgId = input.orgId;
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
      return withDbErrorClassification(() => fn(ambient.trx, input));
    }
    return getDb()
      .transaction()
      .execute(async function (trx) {
        await sql`SET LOCAL app.current_org_id = ${sql.lit(orgId)}`.execute(
          trx
        );
        return txStorage.run({ trx, orgId }, function () {
          return withDbErrorClassification(() => fn(trx, input));
        });
      });
  };
}

// Decorator for unscoped flows — bootstrap, and other flows that create
// the org itself. Joins an ambient runInTx if one exists; refuses to join
// a runInOrgTx, which would silently bypass RLS.
export function runInTx<A, R>(
  fn: (trx: Tx, input: A) => Promise<R>
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
      return withDbErrorClassification(() => fn(ambient.trx, input));
    }
    return getDb()
      .transaction()
      .execute(async function (trx) {
        return txStorage.run({ trx, orgId: null }, function () {
          return withDbErrorClassification(() => fn(trx, input));
        });
      });
  };
}

// Test-only helper. Runs `fn` with a pre-supplied TxContext on the ALS so
// services behave as if they joined an ambient tx. Use with a fake Tx for
// unit tests.
export function withTxContext<T>(
  ctx: TxContext,
  fn: () => Promise<T>
): Promise<T> {
  return txStorage.run(ctx, fn);
}
