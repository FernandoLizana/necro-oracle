// Feature: lovers-binding, task 1.6
// Unit tests for the OpenRouter/model/ceiling/cap env keys added in task 1.5.
//
// Requirements covered:
//   R2.1 — OpenRouter + model ids are optional; absent/blank keeps startup on
//          the Mock/deterministic default (parse to `undefined`).
//   R2.2 — NECRO_LLM_MODEL_FALLBACKS is a comma list -> trimmed string[].
//   R2.7 — ceiling/cap defaults (daily 1000, lovers 200, max-calls 12) and
//          strict positive-safe-int parsing of explicit values.
//   R35.3 — model ids are pure configuration (optional, no fabricated default).
//   R36.1 — the per-reading cap NECRO_LLM_MAX_CALLS_PER_READING default is 12.
//
// Secrets discipline: fake tokens only; every error/warning path is asserted to
// never carry the raw secret value (not in the thrown error, the `keys` array,
// nor the warning message).
import { describe, expect, it, vi } from "vitest";
import { EnvValidationError, loadEnv } from "../src/index.js";

/** An obvious fake token — must never be logged, echoed or leaked. */
const FAKE_KEY = "sk-fake-DO-NOT-LOG";

/** Base source that keeps unrelated required/optional keys out of the way. */
function base(
  extra: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return { GITHUB_TOKEN: undefined, ...extra };
}

/** Run loadEnv and return the thrown error, or fail if it did not throw. */
function caught(source: Record<string, string | undefined>): unknown {
  try {
    loadEnv(source);
  } catch (err) {
    return err;
  }
  throw new Error("expected loadEnv to throw");
}

describe("lovers env keys: absent/blank -> undefined (R2.1, R35.3)", () => {
  const OPTIONAL_KEYS = [
    "OPENROUTER_API_KEY",
    "NECRO_LLM_MODEL_FAST",
    "NECRO_LLM_MODEL_STRONG",
    "NECRO_LLM_MODEL_FALLBACKS",
    "NECRO_PUBLIC_URL",
  ] as const;

  it("parses every optional key to undefined when the whole source is empty", () => {
    const env = loadEnv(base());
    for (const key of OPTIONAL_KEYS) {
      expect(env[key]).toBeUndefined();
    }
  });

  it.each(OPTIONAL_KEYS)(
    "treats an explicit undefined %s as unset",
    (key) => {
      const env = loadEnv(base({ [key]: undefined }));
      expect(env[key]).toBeUndefined();
    },
  );

  it.each(OPTIONAL_KEYS)("treats an empty %s as unset", (key) => {
    const env = loadEnv(base({ [key]: "" }));
    expect(env[key]).toBeUndefined();
  });

  it.each(OPTIONAL_KEYS)(
    "treats a whitespace-only %s as unset",
    (key) => {
      const env = loadEnv(base({ [key]: " \t\r\n " }));
      expect(env[key]).toBeUndefined();
    },
  );
});

describe("NECRO_LLM_MODEL_FALLBACKS comma list -> string[] (R2.2)", () => {
  it("absent -> undefined", () => {
    expect(loadEnv(base()).NECRO_LLM_MODEL_FALLBACKS).toBeUndefined();
  });

  it("a single value -> a one-element array", () => {
    expect(
      loadEnv(base({ NECRO_LLM_MODEL_FALLBACKS: "model/alpha" }))
        .NECRO_LLM_MODEL_FALLBACKS,
    ).toEqual(["model/alpha"]);
  });

  it("a comma list -> a trimmed array", () => {
    expect(
      loadEnv(
        base({ NECRO_LLM_MODEL_FALLBACKS: "model/alpha, model/beta ,model/gamma" }),
      ).NECRO_LLM_MODEL_FALLBACKS,
    ).toEqual(["model/alpha", "model/beta", "model/gamma"]);
  });

  it("drops empty parts (leading/trailing/double commas)", () => {
    expect(
      loadEnv(
        base({ NECRO_LLM_MODEL_FALLBACKS: ",model/alpha,,  ,model/beta," }),
      ).NECRO_LLM_MODEL_FALLBACKS,
    ).toEqual(["model/alpha", "model/beta"]);
  });

  it("a comma-only value collapses to an empty array (no models)", () => {
    expect(
      loadEnv(base({ NECRO_LLM_MODEL_FALLBACKS: " , , " }))
        .NECRO_LLM_MODEL_FALLBACKS,
    ).toEqual([]);
  });
});

describe("model ids are pure configuration (R35.3)", () => {
  it("passes explicit model ids through unchanged", () => {
    const env = loadEnv(
      base({
        NECRO_LLM_MODEL_FAST: "vendor/fast-1",
        NECRO_LLM_MODEL_STRONG: "vendor/strong-1",
      }),
    );
    expect(env.NECRO_LLM_MODEL_FAST).toBe("vendor/fast-1");
    expect(env.NECRO_LLM_MODEL_STRONG).toBe("vendor/strong-1");
  });
});

describe("ceiling/cap defaults and parsing (R2.7, R36.1)", () => {
  it("applies the documented defaults when absent", () => {
    const env = loadEnv(base());
    expect(env.NECRO_LLM_DAILY_CEILING).toBe(1000);
    expect(env.NECRO_LOVERS_DAILY_CEILING).toBe(200);
    expect(env.NECRO_LLM_MAX_CALLS_PER_READING).toBe(12);
  });

  it("applies the defaults when the values are blank", () => {
    const env = loadEnv(
      base({
        NECRO_LLM_DAILY_CEILING: "   ",
        NECRO_LOVERS_DAILY_CEILING: "",
        NECRO_LLM_MAX_CALLS_PER_READING: " \t ",
      }),
    );
    expect(env.NECRO_LLM_DAILY_CEILING).toBe(1000);
    expect(env.NECRO_LOVERS_DAILY_CEILING).toBe(200);
    expect(env.NECRO_LLM_MAX_CALLS_PER_READING).toBe(12);
  });

  it("parses explicit valid values as numbers", () => {
    const env = loadEnv(
      base({
        NECRO_LLM_DAILY_CEILING: "5000",
        NECRO_LOVERS_DAILY_CEILING: "42",
        NECRO_LLM_MAX_CALLS_PER_READING: "3",
      }),
    );
    expect(env.NECRO_LLM_DAILY_CEILING).toBe(5000);
    expect(env.NECRO_LOVERS_DAILY_CEILING).toBe(42);
    expect(env.NECRO_LLM_MAX_CALLS_PER_READING).toBe(3);
    expect(typeof env.NECRO_LLM_DAILY_CEILING).toBe("number");
    expect(typeof env.NECRO_LOVERS_DAILY_CEILING).toBe("number");
    expect(typeof env.NECRO_LLM_MAX_CALLS_PER_READING).toBe("number");
  });

  const CEILING_KEYS = [
    "NECRO_LLM_DAILY_CEILING",
    "NECRO_LOVERS_DAILY_CEILING",
    "NECRO_LLM_MAX_CALLS_PER_READING",
  ] as const;
  const BAD_INTS = [
    ["zero", "0"],
    ["negative", "-1"],
    ["fractional", "1.5"],
    ["leading zero", "01"],
    ["non-numeric", "lots"],
  ] as const;

  for (const key of CEILING_KEYS) {
    it.each(BAD_INTS)(
      `rejects ${key} = %s (%s) naming only the key`,
      (_label, value) => {
        const err = caught(base({ [key]: value }));
        expect(err).toBeInstanceOf(EnvValidationError);
        const typed = err as EnvValidationError;
        expect(typed.keys).toContain(key);
        expect(typed.message).toContain(key);
        // The offending value is never echoed.
        expect(typed.message).not.toContain(value);
      },
    );
  }
});

describe("cross-field rule: key set but model(s) missing warns, never throws (R2.1, R36.1)", () => {
  it("warns naming ONLY the fast key when only fast is missing, keeping Mock default", () => {
    const warn = vi.fn();
    const env = loadEnv(
      base({
        OPENROUTER_API_KEY: FAKE_KEY,
        NECRO_LLM_MODEL_STRONG: "vendor/strong-1",
      }),
      { warn },
    );
    // Does not throw; returns a valid Env staying on the Mock default.
    expect(env.OPENROUTER_API_KEY).toBe(FAKE_KEY);
    expect(env.NECRO_LLM_MODEL_FAST).toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    const message = warn.mock.calls[0]?.[0] as string;
    expect(message).toContain("NECRO_LLM_MODEL_FAST");
    expect(message).not.toContain("NECRO_LLM_MODEL_STRONG");
    // No secret value in the warning.
    expect(message).not.toContain(FAKE_KEY);
  });

  it("warns naming ONLY the strong key when only strong is missing", () => {
    const warn = vi.fn();
    loadEnv(
      base({
        OPENROUTER_API_KEY: FAKE_KEY,
        NECRO_LLM_MODEL_FAST: "vendor/fast-1",
      }),
      { warn },
    );
    expect(warn).toHaveBeenCalledTimes(1);
    const message = warn.mock.calls[0]?.[0] as string;
    expect(message).toContain("NECRO_LLM_MODEL_STRONG");
    expect(message).not.toContain("NECRO_LLM_MODEL_FAST");
    expect(message).not.toContain(FAKE_KEY);
  });

  it("warns exactly once naming BOTH keys when both models are missing", () => {
    const warn = vi.fn();
    loadEnv(base({ OPENROUTER_API_KEY: FAKE_KEY }), { warn });
    expect(warn).toHaveBeenCalledTimes(1);
    const message = warn.mock.calls[0]?.[0] as string;
    expect(message).toContain("NECRO_LLM_MODEL_FAST");
    expect(message).toContain("NECRO_LLM_MODEL_STRONG");
    expect(message).not.toContain(FAKE_KEY);
  });

  it("does NOT warn when the key is set and both models are present", () => {
    const warn = vi.fn();
    loadEnv(
      base({
        OPENROUTER_API_KEY: FAKE_KEY,
        NECRO_LLM_MODEL_FAST: "vendor/fast-1",
        NECRO_LLM_MODEL_STRONG: "vendor/strong-1",
      }),
      { warn },
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("does NOT warn when the key is absent even if both models are missing", () => {
    const warn = vi.fn();
    loadEnv(base(), { warn });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("malformed OPENROUTER_API_KEY still throws, naming only the key (R2.1, R35.3)", () => {
  it.each([
    ["inner space", `${FAKE_KEY} trailing`],
    ["inner tab", `${FAKE_KEY}\tvalue`],
    ["inner newline", `${FAKE_KEY}\nvalue`],
    ["bell control char", `${FAKE_KEY}\u0007value`],
    ["NUL control char", `${FAKE_KEY}\u0000value`],
    ["DEL control char", `${FAKE_KEY}\u007fvalue`],
  ])(
    "rejects a key with %s, naming the key but never its value",
    (_label, value) => {
      // A malformed key must still throw before the cross-field warning runs,
      // so a warn spy must never fire on this path.
      const warn = vi.fn();
      let err: unknown;
      try {
        loadEnv(base({ OPENROUTER_API_KEY: value }), { warn });
        throw new Error("expected loadEnv to throw");
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(EnvValidationError);
      const typed = err as EnvValidationError;
      expect(typed.keys).toContain("OPENROUTER_API_KEY");
      expect(typed.message).toContain("OPENROUTER_API_KEY");
      // The offending value — and the fake-token substring — never leak.
      expect(typed.message).not.toContain(value);
      expect(typed.message).not.toContain(FAKE_KEY);
      expect(JSON.stringify(typed.keys)).not.toContain(FAKE_KEY);
      expect(String(typed)).not.toContain(FAKE_KEY);
      // The warning sink never fires when parsing throws.
      expect(warn).not.toHaveBeenCalled();
    },
  );
});
