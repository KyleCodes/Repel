import { z } from 'zod';

// Convention: zod schemas are exported as `*InputSchema`; the inferred TS type
// drops `Schema` and is exported as `*Input`. `CloneInputSchema` (the validator)
// → `CloneInput` (the type).

const DEFAULT_TEMPLATE = 'repel_dev';

export const CloneInputSchema = z.object({
  branch: z.string().min(1, 'branch is required'),
  template: z.string().min(1).default(DEFAULT_TEMPLATE),
  envFile: z.string().min(1).default('.env.local'),
  force: z.boolean().default(false),
});
export type CloneInput = z.infer<typeof CloneInputSchema>;

export const DropInputSchema = z.object({
  branch: z.string().min(1, 'branch is required'),
});
export type DropInput = z.infer<typeof DropInputSchema>;

export const RefreshTemplateInputSchema = z.object({
  template: z.string().min(1).default(DEFAULT_TEMPLATE),
});
export type RefreshTemplateInput = z.infer<typeof RefreshTemplateInputSchema>;

export const StatusInputSchema = z.object({});
export type StatusInput = z.infer<typeof StatusInputSchema>;

export const NukeInputSchema = z.object({
  yes: z.boolean().default(false),
});
export type NukeInput = z.infer<typeof NukeInputSchema>;

export const CodegenInputSchema = z.object({});
export type CodegenInput = z.infer<typeof CodegenInputSchema>;
