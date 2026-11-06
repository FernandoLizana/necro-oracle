// Command parser & printer — example tests (TEST-FIRST).
//
// Validates: Requirements R2.1, R2.3, R2.4, R2.5, R2.6, R2.10, R2.11, R2.14
//
// These examples pin the concrete, named behaviours the P1–P3 properties cover
// only in aggregate: every name/arg form parses to the right Command, a bare
// repo token summons, empty/whitespace yields `null`, an unrecognised entry
// yields an `unknown` carrying the raw text, command names are matched
// case-insensitively, and `printCommand` emits the canonical lowercase form.
//
// TEST-FIRST: imports from the not-yet-created `./parse.js`, `./print.js` and
// `./types.js`. EXPECTED to fail with a module-resolution error until task 5.2
// implements the command modules. That red is the point.

import { describe, expect, it } from "vitest";
import { parseCommand, parseResurrectTarget } from "./parse.js";
import { printCommand } from "./print.js";
import { MAX_ENTRY_LENGTH, type Command } from "./types.js";

describe("parseCommand — command names and argument forms", () => {
  // R2.1: the eight command names, no-argument forms.
  it("recognises the no-argument commands help and clear (R2.1)", () => {
    expect(parseCommand("help")).toStrictEqual<Command>({ kind: "help" });
    expect(parseCommand("clear")).toStrictEqual<Command>({ kind: "clear" });
  });

  // R2.1 case-insensitivity on the command name.
  it("matches command names case-insensitively (R2.1)", () => {
    expect(parseCommand("HELP")).toStrictEqual<Command>({ kind: "help" });
    expect(parseCommand("Help")).toStrictEqual<Command>({ kind: "help" });
    expect(parseCommand("CLEAR")).toStrictEqual<Command>({ kind: "clear" });
    expect(parseCommand("ReAd")).toStrictEqual<Command>({
      kind: "read",
      spread: "necropsy",
    });
  });

  // R2.4: read with and without a spread name; default is necropsy.
  it("parses read with each spread name and defaults to necropsy (R2.4)", () => {
    expect(parseCommand("read")).toStrictEqual<Command>({
      kind: "read",
      spread: "necropsy",
    });
    expect(parseCommand("read fates")).toStrictEqual<Command>({
      kind: "read",
      spread: "fates",
    });
    expect(parseCommand("read necropsy")).toStrictEqual<Command>({
      kind: "read",
      spread: "necropsy",
    });
    expect(parseCommand("read celtic")).toStrictEqual<Command>({
      kind: "read",
      spread: "celtic",
    });
  });

  // R2.2 / R2.3: `summon <repo>` keeps the repo token unchanged.
  it("parses summon with an explicit repo argument, unchanged (R2.2)", () => {
    expect(parseCommand("summon octocat/Hello-World")).toStrictEqual<Command>({
      kind: "summon",
      repo: "octocat/Hello-World",
    });
    expect(
      parseCommand("summon https://github.com/octocat/Hello-World"),
    ).toStrictEqual<Command>({
      kind: "summon",
      repo: "https://github.com/octocat/Hello-World",
    });
  });

  // R2.3: a bare token that looks like a repo ref summons it.
  it("parses a bare owner/repo token as a summon (R2.3)", () => {
    expect(parseCommand("octocat/Hello-World")).toStrictEqual<Command>({
      kind: "summon",
      repo: "octocat/Hello-World",
    });
    expect(parseCommand("octocat/Hello-World#main")).toStrictEqual<Command>({
      kind: "summon",
      repo: "octocat/Hello-World#main",
    });
    expect(parseCommand("octocat/Hello-World@abc123")).toStrictEqual<Command>({
      kind: "summon",
      repo: "octocat/Hello-World@abc123",
    });
  });

  // R2.3: a bare github.com URL summons it.
  it("parses a bare github.com URL as a summon (R2.3)", () => {
    expect(
      parseCommand("https://github.com/octocat/Hello-World"),
    ).toStrictEqual<Command>({
      kind: "summon",
      repo: "https://github.com/octocat/Hello-World",
    });
    expect(
      parseCommand("https://www.github.com/octocat/Hello-World"),
    ).toStrictEqual<Command>({
      kind: "summon",
      repo: "https://www.github.com/octocat/Hello-World",
    });
  });

  // R2.5: explain with a 1-based position number.
  it("parses explain with a positive integer position (R2.5)", () => {
    expect(parseCommand("explain 1")).toStrictEqual<Command>({
      kind: "explain",
      target: { kind: "position", position: 1 },
    });
    expect(parseCommand("explain 10")).toStrictEqual<Command>({
      kind: "explain",
      target: { kind: "position", position: 10 },
    });
  });

  // R2.5: explain with a snake_case CardId.
  it("parses explain with a snake_case CardId (R2.5)", () => {
    expect(parseCommand("explain tower")).toStrictEqual<Command>({
      kind: "explain",
      target: { kind: "card", card: "tower" },
    });
    expect(parseCommand("explain hanged_man")).toStrictEqual<Command>({
      kind: "explain",
      target: { kind: "card", card: "hanged_man" },
    });
  });

  // R2.6: motion with and without an argument.
  it("parses motion with each argument and with none (R2.6)", () => {
    expect(parseCommand("motion")).toStrictEqual<Command>({ kind: "motion" });
    expect(parseCommand("motion on")).toStrictEqual<Command>({
      kind: "motion",
      arg: "on",
    });
    expect(parseCommand("motion off")).toStrictEqual<Command>({
      kind: "motion",
      arg: "off",
    });
    expect(parseCommand("motion auto")).toStrictEqual<Command>({
      kind: "motion",
      arg: "auto",
    });
  });

  // R2.7: demo with and without a name.
  it("parses demo with and without a Demo_Name (R2.7)", () => {
    expect(parseCommand("demo")).toStrictEqual<Command>({ kind: "demo" });
    expect(parseCommand("demo lich-py2")).toStrictEqual<Command>({
      kind: "demo",
      name: "lich-py2",
    });
  });

  // R2.8: sound with and without an argument.
  it("parses sound with and without an argument (R2.8)", () => {
    expect(parseCommand("sound")).toStrictEqual<Command>({ kind: "sound" });
    expect(parseCommand("sound on")).toStrictEqual<Command>({
      kind: "sound",
      arg: "on",
    });
    expect(parseCommand("sound off")).toStrictEqual<Command>({
      kind: "sound",
      arg: "off",
    });
  });

  // resurrection-engine R1.4: bare `resurrect` targets every py2 candidate.
  it("parses a bare resurrect as a bare target (R1.4)", () => {
    expect(parseCommand("resurrect")).toStrictEqual<Command>({
      kind: "resurrect",
      target: { kind: "bare" },
    });
    // Command name is matched case-insensitively like every other command.
    expect(parseCommand("RESURRECT")).toStrictEqual<Command>({
      kind: "resurrect",
      target: { kind: "bare" },
    });
    expect(parseCommand("ReSuRrEcT")).toStrictEqual<Command>({
      kind: "resurrect",
      target: { kind: "bare" },
    });
  });

  // resurrection-engine R1.2: a plain token is a card-id target, lowercased
  // to match the canonical card-id casing (mirrors `explain`).
  it("parses resurrect with a card-id argument (R1.1, R1.2)", () => {
    expect(parseCommand("resurrect judgement")).toStrictEqual<Command>({
      kind: "resurrect",
      target: { kind: "card", card: "judgement" },
    });
    expect(parseCommand("resurrect hanged_man")).toStrictEqual<Command>({
      kind: "resurrect",
      target: { kind: "card", card: "hanged_man" },
    });
    // A mixed-case card id is normalised to lowercase.
    expect(parseCommand("resurrect Judgement")).toStrictEqual<Command>({
      kind: "resurrect",
      target: { kind: "card", card: "judgement" },
    });
  });

  // resurrection-engine R1.3: a token with a `/` or a `.py` suffix is a file
  // path, its case preserved because paths are case-sensitive.
  it("parses resurrect with a file-path argument, case preserved (R1.1, R1.3)", () => {
    expect(parseCommand("resurrect src/app.py")).toStrictEqual<Command>({
      kind: "resurrect",
      target: { kind: "file", path: "src/app.py" },
    });
    // A `.py` suffix alone (no slash) is still a file path.
    expect(parseCommand("resurrect app.py")).toStrictEqual<Command>({
      kind: "resurrect",
      target: { kind: "file", path: "app.py" },
    });
    // A directory-only path (slash, no `.py`) is a file path too.
    expect(parseCommand("resurrect pkg/module")).toStrictEqual<Command>({
      kind: "resurrect",
      target: { kind: "file", path: "pkg/module" },
    });
    // Mixed-case path segments are preserved verbatim.
    expect(parseCommand("resurrect Src/App.py")).toStrictEqual<Command>({
      kind: "resurrect",
      target: { kind: "file", path: "Src/App.py" },
    });
  });
});

describe("parseCommand — empty, whitespace and unknown entries", () => {
  // R2.10: empty or whitespace-only input yields no Command.
  it("returns null for an empty or whitespace-only entry (R2.10)", () => {
    expect(parseCommand("")).toBeNull();
    expect(parseCommand("   ")).toBeNull();
    expect(parseCommand("\t\n  ")).toBeNull();
  });

  // R2.11: an unrecognised entry yields an `unknown` carrying the raw entry.
  it("returns an unknown Command carrying the raw entry (R2.11)", () => {
    expect(parseCommand("frobnicate")).toStrictEqual<Command>({
      kind: "unknown",
      raw: "frobnicate",
    });
    // The raw entry is preserved verbatim (surrounding whitespace trimmed per
    // R2.9), including any arguments the user typed after the bad first token.
    expect(parseCommand("wibble wobble")).toStrictEqual<Command>({
      kind: "unknown",
      raw: "wibble wobble",
    });
  });

  // R2.4 mismatch: read with an unknown spread is unknown (not a silent read).
  it("returns unknown for read with an unrecognised spread name", () => {
    expect(parseCommand("read tarot")).toStrictEqual<Command>({
      kind: "unknown",
      raw: "read tarot",
    });
  });

  // R2.7 mismatch: a demo name outside ^[a-z0-9-]{1,32}$ is unknown.
  it("returns unknown for a demo name outside the allowed pattern", () => {
    expect(parseCommand("demo Not_A_Demo")).toStrictEqual<Command>({
      kind: "unknown",
      raw: "demo Not_A_Demo",
    });
  });

  // resurrection-engine R1.1: resurrect accepts at most one argument; extra
  // tokens are rejected as an unknown carrying the trimmed raw entry.
  it("returns unknown for resurrect with extra tokens (R1.1)", () => {
    expect(parseCommand("resurrect a b")).toStrictEqual<Command>({
      kind: "unknown",
      raw: "resurrect a b",
    });
    expect(parseCommand("resurrect src/app.py tower")).toStrictEqual<Command>({
      kind: "unknown",
      raw: "resurrect src/app.py tower",
    });
  });

  // resurrection-engine R1.1: a present-but-empty argument token (surrounding
  // whitespace is trimmed, so `resurrect   ` collapses to a bare `resurrect`,
  // and a quoted empty-looking token still tokenizes to one non-empty token).
  // Whitespace-only trailing input cannot produce an empty token, so the bare
  // form is what survives; this pins that collapse.
  it("collapses trailing whitespace so resurrect stays bare (R1.1, R2.9)", () => {
    expect(parseCommand("resurrect   ")).toStrictEqual<Command>({
      kind: "resurrect",
      target: { kind: "bare" },
    });
    expect(parseCommand("  resurrect\t")).toStrictEqual<Command>({
      kind: "resurrect",
      target: { kind: "bare" },
    });
  });
});

describe("printCommand — canonical form (R2.14)", () => {
  it("emits the lowercase name and single-space-separated arguments", () => {
    expect(printCommand({ kind: "help" })).toBe("help");
    expect(printCommand({ kind: "clear" })).toBe("clear");
    expect(printCommand({ kind: "read", spread: "fates" })).toBe("read fates");
    expect(printCommand({ kind: "read", spread: "necropsy" })).toBe(
      "read necropsy",
    );
    expect(
      printCommand({ kind: "summon", repo: "octocat/Hello-World" }),
    ).toBe("summon octocat/Hello-World");
    expect(
      printCommand({
        kind: "explain",
        target: { kind: "position", position: 3 },
      }),
    ).toBe("explain 3");
    expect(
      printCommand({ kind: "explain", target: { kind: "card", card: "tower" } }),
    ).toBe("explain tower");
    expect(printCommand({ kind: "motion" })).toBe("motion");
    expect(printCommand({ kind: "motion", arg: "auto" })).toBe("motion auto");
  });

  // R2.14 explicitly names demo/sound forms.
  it("emits the canonical demo and sound forms (R2.14)", () => {
    expect(printCommand({ kind: "demo" })).toBe("demo");
    expect(printCommand({ kind: "demo", name: "lich-py2" })).toBe(
      "demo lich-py2",
    );
    expect(printCommand({ kind: "sound" })).toBe("sound");
    expect(printCommand({ kind: "sound", arg: "on" })).toBe("sound on");
    expect(printCommand({ kind: "sound", arg: "off" })).toBe("sound off");
  });

  // resurrection-engine R1.1-R1.4: each resurrect target round-trips through
  // printCommand → parseCommand back to an equal Command.
  it("round-trips every resurrect target form (R1.1-R1.4)", () => {
    const commands: Extract<Command, { kind: "resurrect" }>[] = [
      { kind: "resurrect", target: { kind: "bare" } },
      { kind: "resurrect", target: { kind: "card", card: "judgement" } },
      { kind: "resurrect", target: { kind: "file", path: "src/app.py" } },
    ];
    for (const cmd of commands) {
      expect(printCommand(cmd)).toBe(
        cmd.target.kind === "bare"
          ? "resurrect"
          : cmd.target.kind === "card"
            ? `resurrect ${cmd.target.card}`
            : `resurrect ${cmd.target.path}`,
      );
      expect(parseCommand(printCommand(cmd))).toStrictEqual<Command>(cmd);
    }
  });
});

describe("parseResurrectTarget — token discrimination (R1.2, R1.3, R1.4)", () => {
  // R1.2: a plain token is a card id, lowercased.
  it("treats a plain token as a card id, lowercased (R1.2)", () => {
    expect(parseResurrectTarget("judgement")).toStrictEqual({
      kind: "card",
      card: "judgement",
    });
    expect(parseResurrectTarget("Tower")).toStrictEqual({
      kind: "card",
      card: "tower",
    });
  });

  // R1.3: a token with a `/` or a `.py` suffix is a file path, case preserved.
  it("treats a slash/.py token as a file path, case preserved (R1.3)", () => {
    expect(parseResurrectTarget("src/app.py")).toStrictEqual({
      kind: "file",
      path: "src/app.py",
    });
    expect(parseResurrectTarget("app.py")).toStrictEqual({
      kind: "file",
      path: "app.py",
    });
    expect(parseResurrectTarget("Pkg/Mod")).toStrictEqual({
      kind: "file",
      path: "Pkg/Mod",
    });
  });

  // R1.1: an empty token is rejected (returns null) so the caller maps it to
  // an unknown rather than a malformed target.
  it("returns null for an empty token (R1.1)", () => {
    expect(parseResurrectTarget("")).toBeNull();
  });
});

describe("MAX_ENTRY_LENGTH", () => {
  it("is 200 (R2.13 entry limit, enforced by the Terminal before parsing)", () => {
    expect(MAX_ENTRY_LENGTH).toBe(200);
  });
});
