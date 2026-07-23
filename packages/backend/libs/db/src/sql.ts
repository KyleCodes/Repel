import { Prisma } from './prisma/client';

// The raw-SQL surface for mutations/views that Prisma's query API cannot
// express (SKIP LOCKED, writeable CTEs, partial-index ON CONFLICT, DISTINCT
// ON + LATERAL). A builder constructs a `Sql` (text + bound parameters)
// without any client or connection — which is what keeps the SQL-shape tests
// connection-free — and the runner passes it to `trx.$queryRaw`.
export const sql = Prisma.sql;
export const join = Prisma.join;
export const raw = Prisma.raw;
export const empty = Prisma.empty;
export type Sql = Prisma.Sql;
