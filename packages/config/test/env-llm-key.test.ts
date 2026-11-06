// Feature: resurrection-engine, task 2.5
// Unit tests for the server-only NECRO_LLM_API_KEY parsing (task 2.4).
//
// Requirements covered:
//   R13.1 — the key is read only from the server Env_Schema; it is never the
//           kind of value a serializer would emit (the schema never echoes it).
//   R13.2 — the key value (or any substring) is never written to a log, ledger,
//           error message or trace; here: EnvValidationError surfaces key NAMES
//           only, never values.
//   R13.5 — an absent or empty/whitespace-only key parses to `undefined`
//           (Degraded_Mode input) without a fatal error; a valid key parses
//           through unchanged.
import { describe, expect, it } from "vitest";
import { EnvValidationError, EnvSchema, loadEnv } from "../src/index.js";

const KEY = "NECRO_LLM_API_KEY";

/** Run loadEnv and return the thrown error, or fail if it did not throw. */
function caught(source: Record<string, string | undefined>): unknown {
  try {
    loadEnv(source);
  } catch (err) {
    return err;
  }
  throw new Error("expected loadEnv to throw");
}

describe("loadEnv NECRO_LLM_API_KEY (R13.1, R13.5)", () => {
  it.each([
    ["missing", {}],
    ["undefined", { [KEY]: undefined }],
    ["empty", { [KEY]: "" }],
    ["spaces only", { [KEY]: "   " }],
    ["tabs and newlines only", { [KEY]: " \t\r\n " }],
  ])(
    "treats a %s key as unset (Degraded_Mode input) without a fatal error",
    (_label, source) => {
      // R13.5: absent/empty/whitespace -> undefined, and startup does not throw.
      const env = loadEnv({ GITHUB_TOKEN: undefined, ...source });
      expect(env.NECRO_LLM_API_KEY).toBeUndefined();
    },
  );

  it("parses a valid key through unchanged", () => {
    const key = "sk-live_AbC123xyz_0987654321";
    expect(
      loadEnv({ GITHUB_TOKEN: undefined, [KEY]: key }).NECRO_LLM_API_KEY,
    ).toBe(key);
  });

  it.each([
    ["inner space", "sk_SECRET value"],
    ["inner tab", "sk_SECRET\tvalue"],
    ["inner newline", "sk_SECRET\nvalue"],
    ["bell control char", "sk_SECRET\u0007value"],
    ["NUL control char", "sk_SECRET\u0000value"],
    ["DEL control char", "sk_SECRET\u007fvalue"],
  ])(
    "rejects a malformed key with %s, naming the key but never its value (R13.2)",
    (_label, key) => {
      const err = caught({ GITHUB_TOKEN: undefined, [KEY]: key });
      expect(err).toBeInstanceOf(EnvValidationError);
      const typed = err as EnvValidationError;
      // The key NAME is surfaced...
      expect(typed.keys).toContain(KEY);
      expect(typed.message).toContain(KEY);
      // ...but the offending VALUE (and the secret-like substring) is not.
      expect(typed.message).not.toContain(key);
      expect(typed.message).not.toContain("sk_SECRET");
    },
  );
});

describe("NECRO_LLM_API_KEY value is never emitted by any config serializer (R13.1, R13.2)", () => {
  const SECRET = "sk-live_TOPSECRET_do_not_leak_0987654321";

  it("the EnvValidationError for an unrelated bad key never contains the LLM key value", () => {
    // A valid LLM key alongside an unrelated malformed key: the error names the
    // bad key only and must not echo the (valid) secret LLM key value.
    const err = caught({
      GITHUB_TOKEN: undefined,
      [KEY]: SECRET,
      NECRO_DAILY_REQUEST_CEILING: "not-a-number",
    });
    expect(err).toBeInstanceOf(EnvValidationError);
    const typed = err as EnvValidationError;
    expect(typed.keys).toContain("NECRO_DAILY_REQUEST_CEILING");
    expect(typed.keys).not.toContain(SECRET);
    expect(typed.message).not.toContain(SECRET);
    // Also absent from the serialized/string forms of the error and its keys.
    expect(String(typed)).not.toContain(SECRET);
    expect(JSON.stringify(typed.keys)).not.toContain(SECRET);
  });

  it("the parsed Env object is the only carrier of the value; no schema metadata emits it", () => {
    // The key must parse through so Degraded_Mode can observe presence, but the
    // schema itself (its serializable description) must never embed the value.
    const env = loadEnv({ GITHUB_TOKEN: undefined, [KEY]: SECRET });
    expect(env.NECRO_LLM_API_KEY).toBe(SECRET);

    // No serializer over the schema shape should surface the runtime value: the
    // schema is defined independently of any concrete key, so stringifying its
    // structure can never contain a secret provided at parse time.
    const schemaText = JSON.stringify(Object.keys(EnvSchema.shape));
    expect(schemaText).toContain(KEY); // the NAME is part of the schema
    expect(schemaText).not.toContain(SECRET); // the VALUE never is
  });
});
