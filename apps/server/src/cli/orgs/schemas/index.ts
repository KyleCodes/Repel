import { z } from 'zod';

// Convention: zod schemas are exported as `*InputSchema`; the inferred TS type
// drops `Schema` and is exported as `*Input`. `BootstrapInputSchema` (the
// validator) → `BootstrapInput` (the type).

export const BootstrapInputSchema = z.object({
  orgName: z.string().min(1, 'org name is required'),
  email: z.string().email('valid email is required'),
  name: z.string().min(1).optional(),
  dryRun: z.boolean().default(false),
});
export type BootstrapInput = z.infer<typeof BootstrapInputSchema>;
