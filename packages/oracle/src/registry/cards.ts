// src/registry/cards.ts
//
// The card registry (task 6.2). Builds the 12 CardDefinition entries, validates
// each against CardDefinitionSchema at module load, and guards against duplicate
// `id` or `numeral`. Any failure throws NecroError(REGISTRY_INVALID) at load,
// before CARD_REGISTRY or getCard become usable.
//
// Card meanings follow the oracle-voice steering: a short mystical line, then
// the technical fact the detector actually measures. Numerals and vitality
// weights are fixed by the design (R1.1, R1.2, R18.3).
//
// _Requirements: R1.1, R1.2, R1.3, R1.4, R1.5, R1.6, R5.6, R18.3_
import { CardDefinitionSchema, type CardDefinition, type CardId } from "./schema.js";
import { NecroError } from "../util/errors.js";

// The 12 cards in canonical deck order. Each entry is validated below; the raw
// array is never exported so no consumer can bypass validation.
const CARD_DEFINITIONS: ReadonlyArray<CardDefinition> = [
  {
    id: "judgement",
    numeral: "XX",
    name: "Judgement",
    uprightMeaning:
      "A dead runtime hears the trumpet. The repository targets a Python version past its grave: Python 2 syntax or Python-2-only manifests still rule the code.",
    reversedMeaning:
      "Half-risen, it straddles two worlds. The code leans on six, __future__ imports, or 2to3 shims, carrying one foot in Python 2 and one in Python 3.",
    weight: 20,
    linkedGrimoireIds: ["py2to3", "pyproject"],
  },
  {
    id: "tower",
    numeral: "XVI",
    name: "The Tower",
    uprightMeaning:
      "The foundations crack and burn. Dependencies are yanked, deprecated, Python-2-only, or two or more major versions behind the latest known release.",
    reversedMeaning:
      "The stones drift, not yet fallen. Dependencies are unpinned or exactly one major version behind; the tower sways but has not yet collapsed.",
    weight: 15,
    linkedGrimoireIds: ["pyproject"],
  },
  {
    id: "devil",
    numeral: "XV",
    name: "The Devil",
    uprightMeaning:
      "Chains of sin bind this code. Production files call eval, exec, pickle.loads, unsafe yaml.load, shell=True, os.system, or disable TLS verification; known vulnerabilities surface.",
    reversedMeaning:
      "Temptation sleeps in the shadows. Dangerous patterns appear only in tests or examples, latent rather than shipped, yet still a sin waiting to wake.",
    weight: 18,
    linkedGrimoireIds: [],
  },
  {
    id: "death",
    numeral: "XIII",
    name: "Death",
    uprightMeaning:
      "Corpses lie unburied in these halls. Modules are unreachable from any entrypoint, or many top-level symbols are defined but never used anywhere in the repository.",
    reversedMeaning:
      "Zombies whisper in the comments. Large blocks of commented-out but valid Python linger, dead code preserved as if it might one day rise again.",
    weight: 10,
    linkedGrimoireIds: [],
  },
  {
    id: "wheel",
    numeral: "X",
    name: "Wheel of Fortune",
    uprightMeaning:
      "No tests. Fate alone decides. The repository contains no test files at all; every change is a gamble against an unseen wheel.",
    reversedMeaning:
      "The tests exist, but the wheel is rusted. Test files are present, yet no test-runner configuration is found to turn them into a verdict.",
    weight: 12,
    linkedGrimoireIds: [],
  },
  {
    id: "hermit",
    numeral: "IX",
    name: "The Hermit",
    uprightMeaning:
      "The lantern is dark; no one wrote the way. The repository has no root README; newcomers face the labyrinth without a guide.",
    reversedMeaning:
      "The map is old and lies. The README is tiny or missing key sections, or docstring coverage is thin across public symbols; the guidance exists but misleads.",
    weight: 5,
    linkedGrimoireIds: [],
  },
  {
    id: "hanged_man",
    numeral: "XII",
    name: "The Hanged Man",
    uprightMeaning:
      "Suspended, abandoned, waiting. The repository is archived, or it has not been pushed in over two years while open issues still wait for an answer.",
    reversedMeaning:
      "It sways, slowly, still breathing. Activity has slowed for six months to two years, or open pull requests sit aging past half a year without resolution.",
    weight: 8,
    linkedGrimoireIds: [],
  },
  {
    id: "temperance",
    numeral: "XIV",
    name: "Temperance",
    uprightMeaning:
      "No vessel tempers this code. No continuous-integration configuration is found anywhere in the repository; nothing proves a change before it merges.",
    reversedMeaning:
      "The old vessel cracked long ago. The only CI is a legacy Travis configuration, a vessel long since abandoned by its makers.",
    weight: 7,
    linkedGrimoireIds: [],
  },
  {
    id: "justice",
    numeral: "XI",
    name: "Justice",
    uprightMeaning:
      "No law governs this code. The repository declares no usable license, or GitHub reports NOASSERTION; the terms of use are undefined.",
    reversedMeaning:
      "The law is written in two tongues. More than one distinct license file is present, and their terms may disagree with one another.",
    weight: 6,
    linkedGrimoireIds: [],
  },
  {
    id: "moon",
    numeral: "XVIII",
    name: "The Moon",
    uprightMeaning:
      "A labyrinth under a pale moon. Two or more files exceed a thousand lines, or nesting depth runs past six levels; the path through the code is lost in fog.",
    reversedMeaning:
      "Fog lies thick on the path. A single oversized file or many confusion markers (TODO, FIXME, HACK, XXX) cloud the way without yet blocking it.",
    weight: 9,
    linkedGrimoireIds: [],
  },
  {
    id: "star",
    numeral: "XVII",
    name: "The Star",
    uprightMeaning:
      "Yet a star still shines. Three or more signs of life endure: a license, tests, CI, a README, and a recent push all count toward hope.",
    reversedMeaning:
      "A faint star, but a star. One or two signs of life remain; the repository is dim but not wholly without hope.",
    weight: 0,
    linkedGrimoireIds: [],
  },
  {
    id: "world",
    numeral: "XXI",
    name: "The World",
    uprightMeaning:
      "The circle closes. It lives. The ritual reached REVIVED: every gate held and the body rose with its vitality restored.",
    reversedMeaning:
      "The circle wavers, unfinished. The ritual reached UNDEAD: it walks, but not every gate held and its soul is left unproven.",
    weight: 0,
    linkedGrimoireIds: [],
  },
];

/**
 * Build and freeze the registry. Called once at module load. Validates every
 * entry against CardDefinitionSchema and rejects duplicate `id` or `numeral`.
 * Throws NecroError(REGISTRY_INVALID) on any failure so the throw happens before
 * CARD_REGISTRY and getCard are usable.
 */
function buildRegistry(
  definitions: ReadonlyArray<CardDefinition>,
): ReadonlyMap<CardId, CardDefinition> {
  const registry = new Map<CardId, CardDefinition>();
  const seenNumerals = new Map<string, string>(); // numeral -> owning card id

  for (const raw of definitions) {
    const result = CardDefinitionSchema.safeParse(raw);
    if (!result.success) {
      throw new NecroError(
        "REGISTRY_INVALID",
        `The deck is malformed: card "${raw.id}" failed validation (${result.error.issues
          .map((i) => i.message)
          .join("; ")}).`,
        result.error,
      );
    }
    const def = result.data as CardDefinition;
    const id = def.id as CardId;

    if (registry.has(id)) {
      throw new NecroError(
        "REGISTRY_INVALID",
        `The deck is malformed: duplicate card id "${id}".`,
      );
    }
    const numeralOwner = seenNumerals.get(def.numeral);
    if (numeralOwner !== undefined) {
      throw new NecroError(
        "REGISTRY_INVALID",
        `The deck is malformed: cards "${numeralOwner}" and "${id}" share numeral "${def.numeral}".`,
      );
    }

    seenNumerals.set(def.numeral, id);
    registry.set(id, def);
  }

  return registry;
}

/** The validated, frozen card registry. Keyed by CardId. */
export const CARD_REGISTRY: ReadonlyMap<CardId, CardDefinition> =
  buildRegistry(CARD_DEFINITIONS);

/**
 * Look up a card definition by id.
 *
 * @throws NecroError(CARD_NOT_FOUND) when the id is not registered. The id is
 *   typed as CardId, but a runtime consumer can still pass an unknown value, so
 *   this guard names the unrecognized id per R1.5.
 */
export function getCard(id: CardId): CardDefinition {
  const def = CARD_REGISTRY.get(id);
  if (def === undefined) {
    throw new NecroError(
      "CARD_NOT_FOUND",
      `The deck holds no card named "${id}".`,
    );
  }
  return def;
}
