import { z } from "zod";

export const PypiDocSchema = z.object({
  info: z.object({
    name: z.string().min(1),
    version: z.string().min(1),
    classifiers: z.array(z.string()).default([]),
    yanked: z.boolean().optional(),
  }),
  urls: z
    .array(z.object({ upload_time_iso_8601: z.string().datetime({ offset: true }) }))
    .default([]),
});
export type PypiDoc = z.infer<typeof PypiDocSchema>;
