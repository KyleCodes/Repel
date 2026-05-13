import { z } from 'zod';

// Convention: zod schemas are exported as `*Schema`; the inferred TS type
// drops the suffix. `CloneSchema` (the validator) → `CloneInput` (the type).

const DEFAULT_TEMPLATE = 'repel_dev';

export const CloneSchema = z.object({
  branch: z.string().min(1, 'branch is required'),
  template: z.string().min(1).default(DEFAULT_TEMPLATE),
  envFile: z.string().min(1).default('.env.local'),
  force: z.boolean().default(false),
});
export type CloneInput = z.infer<typeof CloneSchema>;

export const DropSchema = z.object({
  branch: z.string().min(1, 'branch is required'),
});
export type DropInput = z.infer<typeof DropSchema>;

export const RefreshTemplateSchema = z.object({
  template: z.string().min(1).default(DEFAULT_TEMPLATE),
});
export type RefreshTemplateInput = z.infer<typeof RefreshTemplateSchema>;

export const MigrateCreateSchema = z.object({
  name: z.string().min(1).optional(),
});
export type MigrateCreateInput = z.infer<typeof MigrateCreateSchema>;

export const MigrateUpSchema = z.object({
  target: z.string().min(1).optional(),
});
export type MigrateUpInput = z.infer<typeof MigrateUpSchema>;

export const MigrateDownSchema = z.object({
  target: z.string().min(1).optional(),
});
export type MigrateDownInput = z.infer<typeof MigrateDownSchema>;

export const StatusSchema = z.object({});
export type StatusInput = z.infer<typeof StatusSchema>;
