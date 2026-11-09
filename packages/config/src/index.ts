// @necro/config â€” env schema validated at startup (zod); never prints tokens
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
 * - `NECRO_LLM_API_KEY` is the server-only LLM credential: optional, with blank
 *   or whitespace-only values treated as unset (absent/empty keeps startup in
 *   Degraded_Mode rather than failing); a present value must contain no
 *   whitespace or control characters. Never sent to the client.
 * - `NECRO_DAILY_REQUEST_CEILING` is a positive safe integer in canonical
 *   decimal (no leading zero, sign, decimal point or exponent); defaults to
 *   1000 and is emitted as a number.
 * - `NECRO_CLIENT_IP_HEADER` is a lowercase header name; defaults to
 *   `x-real-ip`.
 * - `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` are optional
 *   deployment keys.
 * - `OPENROUTER_API_KEY` is the server-only OpenRouter credential: optional,
 *   with blank/whitespace-only treated as unset (absent keeps startup on the
 *   Mock/deterministic default rather than failing); a present value must
 *   contain no whitespace or control characters. Never sent to the client.
 * - `NECRO_LLM_MODEL_FAST` / `NECRO_LLM_MODEL_STRONG` are optional model ids
 *   (pure configuration; their defaults are documented only in
 *   `docs/PROMPTS.md`, never hardcoded here).
 * - `NECRO_LLM_MODEL_FALLBACKS` is an optional comma-separated list of model
 *   ids, emitted as a trimmed `string[]` (absent/blank => `undefined`).
 * - `NECRO_LLM_DAILY_CEILING` (default 1000), `NECRO_LOVERS_DAILY_CEILING`
 *   (default 200) and `NECRO_LLM_MAX_CALLS_PER_READING` (default 12) are
 *   positive safe integers in canonical decimal, emitted as numbers.
 * - `NECRO_PUBLIC_URL` is an optional URL used for the OpenRouter
 *   `HTTP-Referer` header.
 *
 * No `NECRO_LLM_SEED` env var or seed constant exists: `seed` is never sent;
 * determinism comes from temperature 0 + the response cache.
 */
export const EnvSchema = z.object({
  GITHUB_TOKEN: z.preprocess(
    blankToUndefined,
    // Intentionally rejects control characters.
    z.string().regex(/^[^\s\x00-\x1f\x7f]+$/).optional(),
  ),
  // Server-only LLM credential; absent/blank keeps startup in Degraded_Mode.
  NECRO_LLM_API_KEY: z.preprocess(
    blankToUndefined,
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
  // Server-only OpenRouter credential; absent/blank keeps startup on Mock.
  OPENROUTER_API_KEY: z.preprocess(
    blankToUndefined,
    z.string().regex(/^[^\s\x00-\x1f\x7f]+$/).optional(),
  ),
  // Model ids are pure configuration; defaults live only in docs/PROMPTS.md.
  NECRO_LLM_MODEL_FAST: z.preprocess(
    blankToUndefined,
    z.string().min(1).optional(),
  ),
  NECRO_LLM_MODEL_STRONG: z.preprocess(
    blankToUndefined,
    z.string().min(1).optional(),
  ),
  // Comma-separated list of fallback model ids -> trimmed string[].
  NECRO_LLM_MODEL_FALLBACKS: z.preprocess(
    blankToUndefined,
    z
      .string()
      .optional()
      .transform((s) =>
        s === undefined
          ? undefined
          : s
              .split(",")
              .map((part) => part.trim())
              .filter((part) => part.length > 0),
      ),
  ),
  // Server-key token/request ceiling (positive safe int, canonical decimal).
  NECRO_LLM_DAILY_CEILING: z.preprocess(
    blankToUndefined,
    z
      .string()
      .regex(/^[1-9][0-9]*$/)
      .refine((s) => Number.isSafeInteger(Number(s)))
      .default("1000")
      .transform(Number),
  ),
  // Separate lovers-ritual daily ceiling.
  NECRO_LOVERS_DAILY_CEILING: z.preprocess(
    blankToUndefined,
    z
      .string()
      .regex(/^[1-9][0-9]*$/)
      .refine((s) => Number.isSafeInteger(Number(s)))
      .default("200")
      .transform(Number),
  ),
  // Separate tarot-reading daily ceiling (item 32). UNIT: tarot LLM completions
  // per UTC day, server-key only. DEFAULT: 300. A tarot reading is one FAST
  // completion; once this many have run today on the server key, further tarot
  // readings fall back to the deterministic offline text (never an error).
  NECRO_TAROT_DAILY_CEILING: z.preprocess(
    blankToUndefined,
    z
      .string()
      .regex(/^[1-9][0-9]*$/)
      .refine((s) => Number.isSafeInteger(Number(s)))
      .default("300")
      .transform(Number),
  ),
  // Total LLM calls per reading (A.8 per-reading cap).
  NECRO_LLM_MAX_CALLS_PER_READING: z.preprocess(
    blankToUndefined,
    z
      .string()
      .regex(/^[1-9][0-9]*$/)
      .refine((s) => Number.isSafeInteger(Number(s)))
      .default("12")
      .transform(Number),
  ),
  // Public URL used for the OpenRouter HTTP-Referer header.
  NECRO_PUBLIC_URL: z.preprocess(
    blankToUndefined,
    z.string().url().optional(),
  ),
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * Sink for non-fatal, key-name-only configuration warnings. Receives a message
 * that names only env KEYS, never any value. Defaults to `console.warn`.
 */
export type EnvWarn = (message: string) => void;

/**
 * Default warning sink. Resolves `console.warn` off `globalThis` at call time
 * so the package needs no DOM/Node ambient lib; falls back to a no-op when no
 * console is available. Only ever receives a key-name-only message.
 */
const defaultWarn: EnvWarn = (message) => {
  const maybeConsole = (
    globalThis as { console?: { warn?: (msg: string) => void } }
  ).console;
  maybeConsole?.warn?.(message);
};

/**
 * Options for {@link loadEnv}. `warn` lets a caller (or a test) capture the
 * non-fatal cross-field warning; it defaults to `console.warn`.
 */
export interface LoadEnvOptions {
  readonly warn?: EnvWarn;
}

/**
 * Validate an env source (e.g. `process.env`, read only at composition roots).
 * On failure throws an {@link EnvValidationError} naming only the offending
 * keys, never their values.
 *
 * Cross-field rule (warning, never a throw): if `OPENROUTER_API_KEY` is present
 * but `NECRO_LLM_MODEL_FAST` or `NECRO_LLM_MODEL_STRONG` is missing, this does
 * NOT throw. It logs a key-name-only warning naming ONLY the missing key(s) and
 * leaves the app on the Mock/deterministic default (no model id is fabricated).
 */
export function loadEnv(
  source: Readonly<Record<string, string | undefined>>,
  options: LoadEnvOptions = {},
): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const keys = [
      ...new Set(
        result.error.issues.map((issue) => String(issue.path[0] ?? "env")),
      ),
    ];
    throw new EnvValidationError(keys);
  }
  const env = result.data;

  if (env.OPENROUTER_API_KEY !== undefined) {
    const missing: string[] = [];
    if (env.NECRO_LLM_MODEL_FAST === undefined) {
      missing.push("NECRO_LLM_MODEL_FAST");
    }
    if (env.NECRO_LLM_MODEL_STRONG === undefined) {
      missing.push("NECRO_LLM_MODEL_STRONG");
    }
    if (missing.length > 0) {
      const warn = options.warn ?? defaultWarn;
      // Names only the missing KEY(s); never a value. The app stays on the
      // Mock/deterministic default rather than failing to boot.
      warn(
        `OPENROUTER_API_KEY is set but ${missing.join(", ")} ` +
          `${missing.length === 1 ? "is" : "are"} missing; ` +
          `keeping the Mock/deterministic default (value withheld).`,
      );
    }
  }

  return env;
}
