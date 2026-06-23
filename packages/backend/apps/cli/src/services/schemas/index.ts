import { z } from 'zod';

// Convention: zod schemas are exported as `*InputSchema`; the inferred TS type
// drops `Schema` and is exported as `*Input` (mirrors accounts/schemas).

// `services run [name] [--all]`. Exactly one selector is required: a service
// name, or `--all`. Neither (a bare `services run`) and both are rejected so the
// launcher never has to guess which services to boot. `name` validity (is it a
// registered service?) is checked in the handler against the registry, not here.
export const ServicesRunInputSchema = z
  .object({
    name: z.string().min(1).optional(),
    all: z.boolean().default(false),
  })
  .refine((v) => v.all !== (v.name !== undefined), {
    message: 'pass exactly one of <name> or --all',
  });
export type ServicesRunInput = z.infer<typeof ServicesRunInputSchema>;
