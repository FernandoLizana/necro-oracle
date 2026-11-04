import { z } from "zod";

export const NpmDocSchema = z.object({
  name: z.string().min(1),
  "dist-tags": z.object({ latest: z.string().min(1) }),
  versions: z.record(z.unknown()), // only versions[latest] is validated further
  modified: z.string().datetime({ offset: true }).optional(),
});
export type NpmDoc = z.infer<typeof NpmDocSchema>;

export const NpmVersionSchema = z.object({ deprecated: z.string().optional() });
