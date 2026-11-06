// Unit tests for the Node-only Demo_Mode fixture loader (task 16.2; R14.1,
// R14.6). Everything runs offline: the loader drives the real oracle over the
// on-disk `lich-py2` fixtures — no network, LLM, or sandbox call is made.

import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { NecroError } from "@necro/oracle";

import { PYTHON2_TO_PYTHON3 } from "../registry.js";
import {
  LICH_PY2_FIXTURE,
  loadDemoRitualInput,
} from "./load-fixture.js";

/** Absolute path to fixtures/graveyard/, resolved relative to this module. */
const FIXTURES_ROOT = fileURLToPath(
  new URL("../../../../fixtures/graveyard/", import.meta.url),
);

const NOW = "2026-01-15T12:00:00.000Z";

describe("loadDemoRitualInput — lich-py2 (R14.1)", () => {
  it("builds a complete RitualInput flagged demo:true from the fixtures", async () => {
    const input = await loadDemoRitualInput({ fixturesRoot: FIXTURES_ROOT, now: NOW });

    expect(input.demo).toBe(true);
    expect(input.pairId).toBe(PYTHON2_TO_PYTHON3);
    expect(input.now).toBe(NOW);
    // Default target is a bare run (all py2 candidates).
    expect(input.target).toEqual({ kind: "bare" });
    // Default spread is the necropsy five-card spread the golden is pinned to.
    expect(input.spread).toBe("necropsy");
  });

  it("pins the graveyard ref so the spread seed is stable across runs (R14.5)", async () => {
    const a = await loadDemoRitualInput({ fixturesRoot: FIXTURES_ROOT, now: NOW });
    const b = await loadDemoRitualInput({ fixturesRoot: FIXTURES_ROOT, now: NOW });

    expect(a.snapshot.ref.owner).toBe("graveyard");
    expect(a.snapshot.ref.name).toBe(LICH_PY2_FIXTURE);
    // Same fixtures + same clock => identical ref (and thus identical spread seed).
    expect(a.snapshot.ref).toEqual(b.snapshot.ref);
    // The reading's draws are identical across runs (id aside).
    expect(a.reading.draws).toEqual(b.reading.draws);
  });

  it("produces a reading whose Judgement draw the Pre_Pass can clear (R16.1-R16.4)", async () => {
    const input = await loadDemoRitualInput({ fixturesRoot: FIXTURES_ROOT, now: NOW });
    const cards = input.reading.draws.map((d) => d.card);
    // The lich-py2 fixtures are authored so Judgement is drawn before the ritual.
    expect(cards).toContain("judgement");
  });

  it("honours an explicit target and spread", async () => {
    const input = await loadDemoRitualInput({
      fixturesRoot: FIXTURES_ROOT,
      now: NOW,
      target: { kind: "card", card: "judgement" },
      spread: "fates",
    });
    expect(input.target).toEqual({ kind: "card", card: "judgement" });
    expect(input.spread).toBe("fates");
  });

  it("raises DEMO_FIXTURE_MISSING when a required fixture is missing (R14.6)", async () => {
    const badRoot = fileURLToPath(
      new URL("../../../../fixtures/graveyard-does-not-exist/", import.meta.url),
    );
    await expect(
      loadDemoRitualInput({ fixturesRoot: badRoot, now: NOW }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof NecroError &&
        (err.code as string) === "DEMO_FIXTURE_MISSING",
    );
  });

  it("the DEMO_FIXTURE_MISSING message names no path/secret/stack (R12.5)", async () => {
    const badRoot = fileURLToPath(
      new URL("../../../../fixtures/graveyard-missing/", import.meta.url),
    );
    let caught: NecroError | undefined;
    try {
      await loadDemoRitualInput({ fixturesRoot: badRoot, now: NOW });
    } catch (e) {
      caught = e as NecroError;
    }
    expect(caught).toBeInstanceOf(NecroError);
    expect(caught?.userMessage).not.toContain(badRoot);
    expect(caught?.userMessage).not.toMatch(/graveyard-missing/);
  });
});
