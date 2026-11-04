import { z } from "zod";

export const OsvBatchResponseSchema = z.object({
  results: z.array(
    z.object({
      vulns: z.array(z.object({ id: z.string().min(1) })).optional(),
      next_page_token: z.string().optional(), // present → truncated; recorded as skipped
    }),
  ),
});

export const OsvVulnSchema = z.object({
  id: z.string().min(1),
  aliases: z.array(z.string()).optional(),
  database_specific: z.record(z.unknown()).optional(),
  affected: z
    .array(
      z.object({
        package: z.object({ name: z.string(), ecosystem: z.string() }).optional(),
        ranges: z
          .array(z.object({ type: z.string(), events: z.array(z.record(z.string())) }))
          .optional(),
        versions: z.array(z.string()).optional(),
      }),
    )
    .optional(),
});
export type OsvVuln = z.infer<typeof OsvVulnSchema>;
