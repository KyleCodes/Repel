import { z } from 'zod';

export const MigrateCreateInputSchema = z.object({
  name: z.string().min(1).optional(),
});
export type MigrateCreateInput = z.infer<typeof MigrateCreateInputSchema>;

export const MigrateUpInputSchema = z.object({
  match: z.string().min(1).optional(),
});
export type MigrateUpInput = z.infer<typeof MigrateUpInputSchema>;

export const MigrateDownInputSchema = z
  .object({
    match: z.string().min(1).optional(),
    base: z.boolean().optional(),
  })
  .refine((v) => !(v.match && v.base), {
    message: 'Pass either [match] or --base, not both.',
  });
export type MigrateDownInput = z.infer<typeof MigrateDownInputSchema>;
