import { runInTx } from '../tx.ts';
import { listApplied } from './views/list-applied.ts';

// `pgmigrations` is unscoped infrastructure metadata — no orgId, no RLS.
// Uses runInTx (not runInOrgTx) per ADR-010. Service owns the transaction
// decorator; the view holds only the query.

export const migrationsService = {
  listApplied: runInTx(async function (trx, _input: void) {
    return listApplied(trx);
  }),
};
