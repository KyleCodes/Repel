import { z } from 'zod';

export const MigrateCreateInputSchema = z.object({
  name: z.string().min(1).optional(),
});
export type MigrateCreateInput = z.infer<typeof MigrateCreateInputSchema>;

// No targeting input: `prisma migrate deploy` always applies every pending
// migration in order (the old node-pg-migrate `[match]` partial-apply has no
// Prisma equivalent). `down` is gone with it — Prisma Migrate has no down
// migrations; the reset path is `repel db nuke` + `repel db migrations up`.
export const MigrateUpInputSchema = z.object({});
export type MigrateUpInput = z.infer<typeof MigrateUpInputSchema>;
