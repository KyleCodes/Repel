import { z } from 'zod';

const DEFAULT_TEMPLATE = 'repel_dev';

export const CloneInput = z.object({
  branch: z.string().min(1, 'branch is required'),
  template: z.string().min(1).default(DEFAULT_TEMPLATE),
  envFile: z.string().min(1).default('.env.local'),
  force: z.boolean().default(false),
});
export type CloneInput = z.infer<typeof CloneInput>;

export const DropInput = z.object({
  branch: z.string().min(1, 'branch is required'),
});
export type DropInput = z.infer<typeof DropInput>;

export const RefreshTemplateInput = z.object({
  template: z.string().min(1).default(DEFAULT_TEMPLATE),
});
export type RefreshTemplateInput = z.infer<typeof RefreshTemplateInput>;

export const MigrateCreateInput = z.object({
  name: z.string().min(1).optional(),
});
export type MigrateCreateInput = z.infer<typeof MigrateCreateInput>;

export const MigrateUpInput = z.object({
  target: z.string().min(1).optional(),
});
export type MigrateUpInput = z.infer<typeof MigrateUpInput>;

export const MigrateDownInput = z.object({
  target: z.string().min(1).optional(),
});
export type MigrateDownInput = z.infer<typeof MigrateDownInput>;

export const StatusInput = z.object({});
export type StatusInput = z.infer<typeof StatusInput>;
