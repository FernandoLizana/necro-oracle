// @necro/config — env schema validated at startup (zod); never prints tokens
import { z } from "zod";

export const CONFIG_VERSION = "0.0.0";

/**
 * Typed error raised when an env source fails validation. Carries only the
 * offending key names, never their values, so secrets are never surfaced in
 * logs, messages or the `keys` array.
 */
export class EnvValidationError extends Error {
  readonly keys: readonly string[];

  constructor(keys: readonly string[]) {
    super(
      `Invalid environment: ${keys.join(", ")} is malformed (value withheld).`,
    );
    this.name = "EnvValidationError";
    this.keys = keys;
    // Restore prototype chain for `instanceof` across transpilation targets.
    Object.setPrototypeOf(this, EnvValidationError.prototype);
  }
}

/**
 * Treat blank or whitespace-only strings as unset so that an empty env var is
 * equivalent to an absent one (and the schema default applies).
 */
const blankToUndefined = (v: unknown): unknown =>
  typeof v === "string" && v.trim() === "" ? undefined : v;

/**
 * Environment schema.
 *
 * - `GITHUB_TOKEN` is optional: blank or whitespace-only values are treated as
 *   unset; a present value must contain no whitespace or control characters.
 * - `NECRO_DAILY_REQUEST_CEILING` is a positive safe integer in canonical
 *   decimal (no leading zero, sign, decimal point or exponent); defaults to
 *   1000 and is emitted as a number.
 * - `NECRO_CLIENT_IP_HEADER` is a lowercase header name; defaults to
 *   `x-real-ip`.
 * - `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` are optional
 *   deployment keys.
 */
export const EnvSchema = z.object({
  GITHUB_TOKEN: z.preprocess(
    blankToUndefined,
    // Intentionally rejects control characters.
    z.string().regex(/^[^\s\x00-\x1f\x7f]+$/).optional(),
  ),
  NECRO_DAILY_REQUEST_CEILING: z.preprocess(
    blankToUndefined,
    z
      .string()
      .regex(/^[1-9][0-9]*$/)
      .refine((s) => Number.isSafeInteger(Number(s)))
      .default("1000")
      .transform(Number),
  ),
  NECRO_CLIENT_IP_HEADER: z.preprocess(
    blankToUndefined,
    z.string().regex(/^[a-z0-9-]{1,64}$/).default("x-real-ip"),
  ),
  UPSTASH_REDIS_REST_URL: z.preprocess(
    blankToUndefined,
    z.string().url().optional(),
  ),
  UPSTASH_REDIS_REST_TOKEN: z.preprocess(
    blankToUndefined,
    z.string().min(1).optional(),
  ),
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * Validate an env source (e.g. `process.env`, read only at composition roots).
 * On failure throws an {@link EnvValidationError} naming only the offending
 * keys, never their values.
 */
export function loadEnv(source: Readonly<Record<string, string | undefined>>): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const keys = [
      ...new Set(
        result.error.issues.map((issue) => String(issue.path[0] ?? "env")),
      ),
    ];
    throw new EnvValidationError(keys);
  }
  return result.data;
}
