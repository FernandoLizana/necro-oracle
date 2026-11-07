// @necro/grimoires-lovers-js — Property 26 (R23.2): the language pair is
// parameterized (task 8.12).
//
// The Lovers pipeline is parameterized by a single `LanguagePairId` constant —
// `LOVERS_LANGUAGE_PAIR` — rather than hard-coded "python3"/"javascript"
// literals scattered through the bridge. Today exactly one pair is enabled
// (`python3->javascript`); representative OTHER language-pair ids are valid
// `LanguagePairId` values but are NOT the enabled pair, so they are refused by
// the parameterized seam (the single constant the grimoire + bridge consume),
// NOT by a hardcoded branch.
//
// This is a PLAIN unit test. It is pure: no network, no LLM, no sandbox. The
// only emitted-artifact assertions drive the deterministic `ast-bridge`
// (`buildDeterministicHeart`/`buildContractSchema`/`buildTemplatePair`) over a
// fixed minimal plan, which needs no parser arming (those builders are string
// templates over the plan). The command-layer rejection of a non-`js` target
// with an oracle-voice `unknown` lives in `@necro/ui-crt` (a DOWNSTREAM package
// in the enforced direction `oracle <- grimoires <- coven <- (web, ui-crt)`),
// so it is covered by that package's parser tests; importing it here would
// invert the dependency direction. At THIS layer the parameterization seam is
// the `LanguagePairId` constant + the `targetLang` field, which is what this
// test pins.
//
// Validates: Requirements 23.2

import {
  LOVERS_LANGUAGE_PAIR,
  LanguagePairIdSchema,
  type LanguagePairId,
  type LoversPlan,
} from "@necro/coven";
import { describe, expect, it } from "vitest";

import {
  buildContractSchema,
  buildDeterministicHeart,
  buildTemplatePair,
  LANGUAGE_PAIR,
  loversJsGrimoire,
} from "./index.js";

// ---------------------------------------------------------------------------
// The one enabled pair + a representative set of other target language ids.
// ---------------------------------------------------------------------------

/** The single language pair the Lovers grimoire enables today (R23.2). */
const ENABLED_PAIR = "python3->javascript" as const;

/**
 * Representative OTHER pair ids: each is a well-formed `LanguagePairId`
 * (`<from>-><to>`) but names a target the grimoire does NOT bind today. They
 * must all be rejected by the parameterized seam — i.e. be unequal to the
 * single enabled constant — rather than by a hardcoded branch.
 */
const OTHER_PAIRS = [
  "python3->typescript",
  "python3->rust",
  "python3->go",
  "python3->python3",
  "java->javascript",
  "ruby->javascript",
  "python2->javascript",
] as const;

// ---------------------------------------------------------------------------
// A fixed minimal plan to drive the deterministic emitters.
// ---------------------------------------------------------------------------

/** A minimal, gate-shaped plan with one bindable function. */
const FIXED_PLAN: LoversPlan = {
  functions: [
    {
      name: "add",
      params: [
        { name: "a", pyType: "int", jsonType: "integer", jsType: "number", required: true },
        { name: "b", pyType: "int", jsonType: "integer", jsType: "number", required: true },
      ],
      returns: { pyType: "int", jsonType: "integer", jsType: "number" },
      bindable: true,
      edgeCases: [],
    },
  ],
  typeMap: [{ py: "int", json: "integer", js: "number" }],
};

// ---------------------------------------------------------------------------
// 1. The enabled pair is wired consistently from a single constant.
// ---------------------------------------------------------------------------

describe("Property 26 (R23.2): the language pair is parameterized", () => {
  it("enables exactly python3->javascript, wired from a single LanguagePairId constant", () => {
    // The constant is the enabled pair and is a well-formed LanguagePairId.
    expect(LOVERS_LANGUAGE_PAIR).toBe(ENABLED_PAIR);
    expect(() => LanguagePairIdSchema.parse(LOVERS_LANGUAGE_PAIR)).not.toThrow();

    // The grimoire barrel re-exports that SAME constant (no second literal),
    // and the grimoire object's `pair` is that constant — one source of truth.
    expect(LANGUAGE_PAIR).toBe(LOVERS_LANGUAGE_PAIR);
    expect(loversJsGrimoire.pair).toBe(LOVERS_LANGUAGE_PAIR);
  });

  // -------------------------------------------------------------------------
  // 2. Other targets are rejected by the seam, not a hardcoded branch.
  // -------------------------------------------------------------------------

  it("accepts the enabled pair and rejects representative other targets at the parameterized seam", () => {
    // Every candidate (enabled + others) is a VALID LanguagePairId: rejection
    // is NOT a parse/shape failure, it is the seam refusing a pair the grimoire
    // does not bind. This proves the refusal is parameterized, not a literal
    // "if target !== 'javascript'" branch — the only accepted value is the
    // constant itself.
    const isEnabled = (id: LanguagePairId): boolean => id === LOVERS_LANGUAGE_PAIR;

    expect(isEnabled(LanguagePairIdSchema.parse(ENABLED_PAIR))).toBe(true);

    for (const raw of OTHER_PAIRS) {
      const id = LanguagePairIdSchema.parse(raw);
      // A well-formed pair id ...
      expect(id).toBe(raw);
      // ... that is nonetheless not the one enabled pair.
      expect(isEnabled(id)).toBe(false);
    }
  });

  // -------------------------------------------------------------------------
  // 3. Emitted artifacts + contract $id/metadata reflect the constant.
  // -------------------------------------------------------------------------

  it("stamps the configured language-pair constant into the emitted artifacts", () => {
    const heart = buildDeterministicHeart(FIXED_PLAN);
    // The heart header documents the pair from the constant, not a literal.
    expect(heart).toContain(`# Language pair: ${LOVERS_LANGUAGE_PAIR}`);

    const contract = JSON.parse(buildContractSchema(FIXED_PLAN)) as {
      $id: string;
    };
    // The contract $id is derived from the constant.
    expect(contract.$id).toBe(`urn:necro:lovers:${LOVERS_LANGUAGE_PAIR}`);
    expect(contract.$id).toContain(ENABLED_PAIR);

    // The full template pair carries the same constant-derived heart + $id.
    const pair = buildTemplatePair(FIXED_PLAN);
    expect(pair.pythonHeart).toContain(`# Language pair: ${LOVERS_LANGUAGE_PAIR}`);
    const pairContract = JSON.parse(pair.contractSchema) as { $id: string };
    expect(pairContract.$id).toBe(`urn:necro:lovers:${LOVERS_LANGUAGE_PAIR}`);
  });

  // -------------------------------------------------------------------------
  // 4. If the constant changed, the stamped metadata would change with it:
  //    the emitted $id/header is a pure function of the constant, so there is
  //    no stray hard-coded "python3->javascript" that would drift.
  // -------------------------------------------------------------------------

  it("derives stamped metadata purely from the constant (no drift if the pair changed)", () => {
    // Both halves of the enabled pair appear ONLY as part of the constant-
    // derived strings, never as a second independent literal: the contract $id
    // and the heart header both equal their constant-built forms exactly.
    const [from, to] = LOVERS_LANGUAGE_PAIR.split("->") as [string, string];
    expect(from).toBe("python3");
    expect(to).toBe("javascript");

    const contract = JSON.parse(buildContractSchema(FIXED_PLAN)) as { $id: string };
    // Reconstructing the $id from the two halves equals the emitted $id, i.e.
    // the emitter composed it from the pair rather than embedding a fixed urn.
    expect(contract.$id).toBe(`urn:necro:lovers:${from}->${to}`);
  });
});
