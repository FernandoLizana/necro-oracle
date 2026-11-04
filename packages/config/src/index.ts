// @necro/config — env schema validated at startup (zod); never prints tokens
import { z } from "zod";

export const CONFIG_VERSION = "0.0.0";

/**
 * Environment schema. GITHUB_TOKEN is optional: blank or whitespace-only
 * values are treated as unset. A present value must contain no whitespace
 * or control characters.
 */
export const EnvSchema = z.object({
  GITHUB_TOKEN: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    // Intentionally rejects control characters.
    z.string().regex(/^[^\s\x00-\x1f\x7f]+$/).optional(),
  ),
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * Validate an env source (e.g. `process.env`, read only at composition roots).
 * On failure throws an Error naming only the offending keys, never their values.
 */
export function loadEnv(source: Readonly<Record<string, string | undefined>>): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const keys = [
      ...new Set(
        result.error.issues.map((issue) => String(issue.path[0] ?? "env")),
      ),
    ];
    throw new Error(
      `Invalid environment: ${keys.join(", ")} is malformed (value withheld).`,
    );
  }
  return result.data;
}
