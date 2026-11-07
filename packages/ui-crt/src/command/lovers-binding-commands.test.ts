// Command parser — lovers-binding command example tests.
//
// Validates: Requirements R14.1, R14.2, R25.1, R25.5, R25.6, R25.7
//
// These examples pin the concrete, named behaviours of the three additive
// lovers-binding command variants (`lovers`, `key`, `model`). They are pure:
// `parseCommand`/`printCommand`/`MODEL_ID_RE` read nothing but their argument —
// no network, LLM, sandbox, clock or DOM.
//
//   - `lovers <file> <lang>` (R14.1, R14.2): exactly two args; `<lang>` is
//     `js`/`javascript` (case-insensitive) normalised to `"javascript"`, the
//     file preserved in its original case; any other form is `unknown`.
//   - `key set|status|clear` (R25.1): exactly one op from the set; the parser
//     produces only the structured op and NEVER captures or echoes a key value
//     (there is no key-value slot on the `key` command at all).
//   - `model fast|strong <id>` (R25.5, R25.6, R25.7): exactly two args; the id
//     is validated against `MODEL_ID_RE`; a good id yields a `model` command
//     for the right tier, a bad id yields `unknown` (so the terminal shows an
//     Oracle_Voice error).

import { describe, expect, it } from "vitest";
import { MODEL_ID_RE, parseCommand } from "./parse.js";
import { printCommand } from "./print.js";
import type { Command } from "./types.js";

// ---------------------------------------------------------------------------
// `lovers <file> <lang>` (R14.1, R14.2)
// ---------------------------------------------------------------------------

describe("parseCommand — lovers (R14.1, R14.2)", () => {
  // R14.1: exactly two args, `<lang>` js/javascript normalised to
  // `"javascript"`, the file preserved in its ORIGINAL case.
  it("parses `lovers <file> js` normalising the language to javascript (R14.1)", () => {
    expect(parseCommand("lovers src/app.py js")).toStrictEqual<Command>({
      kind: "lovers",
      file: "src/app.py",
      targetLang: "javascript",
    });
    expect(
      parseCommand("lovers src/app.py javascript"),
    ).toStrictEqual<Command>({
      kind: "lovers",
      file: "src/app.py",
      targetLang: "javascript",
    });
  });

  // R14.1: the command name AND the language token are matched
  // case-insensitively; the language still normalises to `"javascript"`.
  it("matches the lovers name and language case-insensitively (R14.1)", () => {
    expect(parseCommand("LOVERS src/app.py JS")).toStrictEqual<Command>({
      kind: "lovers",
      file: "src/app.py",
      targetLang: "javascript",
    });
    expect(parseCommand("Lovers src/app.py JavaScript")).toStrictEqual<Command>(
      {
        kind: "lovers",
        file: "src/app.py",
        targetLang: "javascript",
      },
    );
  });

  // R14.1: the file token keeps its original case because paths are
  // case-sensitive, even when the language token is upper-cased.
  it("preserves the file path case verbatim (R14.1)", () => {
    expect(parseCommand("lovers Src/App.PY js")).toStrictEqual<Command>({
      kind: "lovers",
      file: "Src/App.PY",
      targetLang: "javascript",
    });
  });

  // R14.2: any target language other than js/javascript yields unknown.
  it("returns unknown for an unsupported target language (R14.2)", () => {
    expect(parseCommand("lovers src/app.py rust")).toStrictEqual<Command>({
      kind: "unknown",
      raw: "lovers src/app.py rust",
    });
    expect(parseCommand("lovers src/app.py go")).toStrictEqual<Command>({
      kind: "unknown",
      raw: "lovers src/app.py go",
    });
  });

  // R14.1: exactly two args. Too few or too many tokens are unknown.
  it("returns unknown for the wrong lovers argument count (R14.1)", () => {
    expect(parseCommand("lovers")).toStrictEqual<Command>({
      kind: "unknown",
      raw: "lovers",
    });
    expect(parseCommand("lovers src/app.py")).toStrictEqual<Command>({
      kind: "unknown",
      raw: "lovers src/app.py",
    });
    expect(parseCommand("lovers src/app.py js extra")).toStrictEqual<Command>({
      kind: "unknown",
      raw: "lovers src/app.py js extra",
    });
  });

  // R2.14 round-trip: a `lovers` command prints to its canonical form and
  // re-parses to an equal command.
  it("round-trips a lovers command through printCommand", () => {
    const cmd: Command = {
      kind: "lovers",
      file: "pkg/mod.py",
      targetLang: "javascript",
    };
    expect(printCommand(cmd)).toBe("lovers pkg/mod.py javascript");
    expect(parseCommand(printCommand(cmd))).toStrictEqual(cmd);
  });
});

// ---------------------------------------------------------------------------
// `key set|status|clear` (R25.1)
// ---------------------------------------------------------------------------

describe("parseCommand — key (R25.1)", () => {
  // R25.1: each of the three ops parses to the corresponding `key` command.
  it("parses key set, key status and key clear (R25.1)", () => {
    expect(parseCommand("key set")).toStrictEqual<Command>({
      kind: "key",
      op: "set",
    });
    expect(parseCommand("key status")).toStrictEqual<Command>({
      kind: "key",
      op: "status",
    });
    expect(parseCommand("key clear")).toStrictEqual<Command>({
      kind: "key",
      op: "clear",
    });
  });

  // R25.1: the name and the op are matched case-insensitively.
  it("matches the key name and op case-insensitively (R25.1)", () => {
    expect(parseCommand("KEY SET")).toStrictEqual<Command>({
      kind: "key",
      op: "set",
    });
    expect(parseCommand("Key Status")).toStrictEqual<Command>({
      kind: "key",
      op: "status",
    });
  });

  // R25.1: exactly one op from the set. Zero, extra, or an unknown op token is
  // unknown.
  it("returns unknown for a bad key argument count or op (R25.1)", () => {
    expect(parseCommand("key")).toStrictEqual<Command>({
      kind: "unknown",
      raw: "key",
    });
    expect(parseCommand("key reset")).toStrictEqual<Command>({
      kind: "unknown",
      raw: "key reset",
    });
    expect(parseCommand("key set status")).toStrictEqual<Command>({
      kind: "unknown",
      raw: "key set status",
    });
  });

  // R25.2 (parser contribution): the PARSER never captures a key value. A
  // `key set sk-secret-value` form is NOT a two-op `key` command — it is
  // unknown — so the parser has no slot in which a secret could live, and the
  // raw string it carries is exactly what the user typed (the masked input,
  // not the parser, is where a key is ever entered).
  it("never captures a key value: `key set <value>` is unknown, not a key command (R25.1)", () => {
    const parsed = parseCommand("key set sk-super-secret-abcd1234");
    // The ONLY surface that could hold the typed token is the `unknown.raw`
    // round-trip of the raw entry; the parser produces no structured field that
    // carries the secret as a captured value.
    expect(parsed).toStrictEqual<Command>({
      kind: "unknown",
      raw: "key set sk-super-secret-abcd1234",
    });
    // The parsed command is never a `key` command with an extra captured slot.
    expect(parsed?.kind).not.toBe("key");
  });

  // R2.14 round-trip: each `key` op prints to its canonical form and re-parses.
  it("round-trips every key op through printCommand", () => {
    for (const op of ["set", "status", "clear"] as const) {
      const cmd: Command = { kind: "key", op };
      expect(printCommand(cmd)).toBe(`key ${op}`);
      expect(parseCommand(printCommand(cmd))).toStrictEqual(cmd);
    }
  });
});

// ---------------------------------------------------------------------------
// `model fast|strong <id>` (R25.5, R25.6, R25.7)
// ---------------------------------------------------------------------------

describe("parseCommand — model (R25.5, R25.6, R25.7)", () => {
  // R25.5: a good id produces a `model` override for the right tier, the id
  // preserved (the regex is case-insensitive; ids are opaque to the parser).
  it("parses `model fast <id>` and `model strong <id>` with a valid id (R25.5)", () => {
    expect(parseCommand("model fast openai/gpt-4o-mini")).toStrictEqual<Command>(
      {
        kind: "model",
        tier: "fast",
        id: "openai/gpt-4o-mini",
      },
    );
    expect(
      parseCommand("model strong anthropic/claude-3.5-sonnet"),
    ).toStrictEqual<Command>({
      kind: "model",
      tier: "strong",
      id: "anthropic/claude-3.5-sonnet",
    });
  });

  // R25.7: the id may carry an optional leading `~` routing hint and an
  // optional `:tag` suffix.
  it("accepts the optional ~ routing hint and :tag suffix (R25.7)", () => {
    expect(
      parseCommand("model fast ~openrouter/auto:free"),
    ).toStrictEqual<Command>({
      kind: "model",
      tier: "fast",
      id: "~openrouter/auto:free",
    });
    expect(
      parseCommand("model strong meta-llama/llama-3.1-70b:nitro"),
    ).toStrictEqual<Command>({
      kind: "model",
      tier: "strong",
      id: "meta-llama/llama-3.1-70b:nitro",
    });
  });

  // R25.5: the model name and the tier are matched case-insensitively.
  it("matches the model name and tier case-insensitively (R25.5)", () => {
    expect(parseCommand("MODEL FAST openai/gpt-4o-mini")).toStrictEqual<Command>(
      {
        kind: "model",
        tier: "fast",
        id: "openai/gpt-4o-mini",
      },
    );
  });

  // R25.6: an id that does NOT match MODEL_ID_RE yields unknown so the terminal
  // can show an Oracle_Voice VALIDATION_FAILED error. A bare vendor (no
  // `/model`), a `..` path-traversal form, and an over-length id are rejected.
  it("returns unknown for an id that fails MODEL_ID_RE (R25.6, R25.7)", () => {
    // Bare vendor, no `/model` segment.
    expect(parseCommand("model fast openai")).toStrictEqual<Command>({
      kind: "unknown",
      raw: "model fast openai",
    });
    // `..` path-traversal form.
    expect(
      parseCommand("model strong vendor/../etc/passwd"),
    ).toStrictEqual<Command>({
      kind: "unknown",
      raw: "model strong vendor/../etc/passwd",
    });
    // Over-length id (> 128 chars) is rejected by the length lookahead.
    const overLong = `vendor/${"a".repeat(130)}`;
    expect(parseCommand(`model fast ${overLong}`)).toStrictEqual<Command>({
      kind: "unknown",
      raw: `model fast ${overLong}`,
    });
  });

  // R25.5: an unknown tier is unknown even with an otherwise valid id.
  it("returns unknown for an unrecognised model tier (R25.5)", () => {
    expect(
      parseCommand("model medium openai/gpt-4o-mini"),
    ).toStrictEqual<Command>({
      kind: "unknown",
      raw: "model medium openai/gpt-4o-mini",
    });
  });

  // R25.5: exactly two args. Missing id, or extra tokens, is unknown.
  it("returns unknown for the wrong model argument count (R25.5)", () => {
    expect(parseCommand("model fast")).toStrictEqual<Command>({
      kind: "unknown",
      raw: "model fast",
    });
    expect(
      parseCommand("model fast openai/gpt-4o-mini extra"),
    ).toStrictEqual<Command>({
      kind: "unknown",
      raw: "model fast openai/gpt-4o-mini extra",
    });
  });

  // R2.14 round-trip: a valid model override prints to its canonical form and
  // re-parses to an equal command.
  it("round-trips a model command through printCommand", () => {
    const cmd: Command = {
      kind: "model",
      tier: "strong",
      id: "openai/gpt-4o",
    };
    expect(printCommand(cmd)).toBe("model strong openai/gpt-4o");
    expect(parseCommand(printCommand(cmd))).toStrictEqual(cmd);
  });
});

// ---------------------------------------------------------------------------
// MODEL_ID_RE directly (R25.7)
// ---------------------------------------------------------------------------

describe("MODEL_ID_RE — safe model-id pattern (R25.7)", () => {
  it("accepts well-formed vendor/model ids with optional ~ and :tag (R25.7)", () => {
    const good = [
      "openai/gpt-4o-mini",
      "anthropic/claude-3.5-sonnet",
      "~openrouter/auto:free",
      "meta-llama/llama-3.1-70b:nitro",
      "vendor/model",
      "a/b",
    ];
    for (const id of good) {
      expect(MODEL_ID_RE.test(id)).toBe(true);
    }
  });

  it("rejects whitespace, control chars, `..`, bare vendor and over-length (R25.7)", () => {
    const bad = [
      "openai", // bare vendor, no /model
      "openai/gpt 4o", // whitespace
      "vendor/../model", // path traversal
      "/model", // leading separator, empty vendor
      "vendor/", // trailing separator, empty model
      "vendor/model\n", // control character
      `vendor/${"a".repeat(130)}`, // > 128 chars
    ];
    for (const id of bad) {
      expect(MODEL_ID_RE.test(id)).toBe(false);
    }
  });
});
