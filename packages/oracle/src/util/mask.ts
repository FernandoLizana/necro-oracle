/**
 * Secret masking utility (src/util/mask.ts).
 *
 * Reduces a secret-like value to a short, non-recoverable fingerprint so that
 * raw secrets never survive into evidence, logs, UI or LLM prompts.
 *
 * Contract (design.md):
 *   value.length >= 4 → value.slice(0, 4) + "****"
 *   value.length <  4 → "****"
 *
 * Requirements: R20.1, R20.4
 */
export function maskSecret(value: string): string {
  if (value.length >= 4) {
    return value.slice(0, 4) + "****";
  }
  return "****";
}
