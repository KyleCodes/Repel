import { z } from 'zod';

// `env provision <branch>` computes the per-worktree stack env and writes it to
// .env.local. envFile defaults to '.env.local' (resolved against cwd).
export const ProvisionInputSchema = z.object({
  branch: z.string().min(1, 'branch is required'),
  envFile: z.string().min(1).default('.env.local'),
});
export type ProvisionInput = z.infer<typeof ProvisionInputSchema>;
