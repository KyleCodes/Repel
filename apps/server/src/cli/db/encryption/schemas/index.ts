import { z } from 'zod';

export const GenerateKeyInputSchema = z.object({
  yes: z.boolean().default(false),
});
export type GenerateKeyInput = z.infer<typeof GenerateKeyInputSchema>;
