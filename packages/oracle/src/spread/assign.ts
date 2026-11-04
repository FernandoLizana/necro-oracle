// src/spread/assign.ts
//
// The spread engine (task 28.2). Pure, deterministic assignment of card draws
// into the positional layout of a spread, following design.md "Spread
// Assignment Algorithm" exactly: djb2 SHA-seeded tiebreak on
// `severity × weight`, void sentinel for empty positions, and a `Set<CardId>`
// no-duplicate guard.
//
// `SpreadKind` is declared locally here (rather than imported from
// `src/reading/run.ts`, task 29) to avoid a cross-module dependency before the
// reading schemas exist. The canonical `SpreadKindSchema` in task 29 will infer
// the identical union; the public barrel re-exports this `assignSpread` and the
// `SpreadKind` type stays structurally compatible.
//
// _Requirements: R17.1, R17.2, R17.3, R17.4, R17.5, R17.6, R17.7, R17.8_
import { CARD_REGISTRY } from "../registry/cards.js";
import type { CardDraw, CardId, SpreadPosition } from "../registry/schema.js";

/** The three supported spread shapes. Mirrors `SpreadKindSchema` (task 29). */
export type SpreadKind = "fates" | "necropsy" | "celtic";

/** Generic void-position description (design.md "Void position sentinel"). */
const VOID_DESCRIPTION = "This position holds no card — the void is a sign.";

/**
 * Ritual-specific override for the Necropsy "The Call" void position
 * (design.md). The spec text is authoritative; the test asserts the
 * description CONTAINS "no ritual can be performed".
 */
const NO_RITUAL_DESCRIPTION = "no ritual can be performed — here is why";

/** Position labels per spread kind, in required order (R17.2–R17.4). */
const FATES_LABELS = ["Past", "Present", "Future"] as const;
const NECROPSY_LABELS = [
  "The Corpse",
  "The Wound",
  "The Shadow",
  "The Hope",
  "The Call",
] as const;
const CELTIC_LABELS = [
  "Present",
  "Crossing",
  "Foundation",
  "Recent Past",
  "Crown",
  "Near Future",
  "Self",
  "Environment",
  "Hopes and Fears",
  "Outcome",
] as const;

/**
 * djb2-style hash producing a stable 32-bit seed (design.md "SHA-seeded
 * tiebreaking"). Kept byte-for-byte as specified.
 */
function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
    h = h >>> 0; // keep as uint32
  }
  return h;
}

/** The `severity × weight` product the engine ranks by. */
function product(draw: CardDraw): number {
  return draw.severity * (CARD_REGISTRY.get(draw.card)?.weight ?? 0);
}

/**
 * Rank draws by `severity × weight` descending, breaking ties by
 * `djb2(sha + draw.card)` ascending (R17.5). Deterministic and independent of
 * input order, since the comparator never falls back to original position.
 */
function rankDraws(draws: readonly CardDraw[], sha: string): CardDraw[] {
  return [...draws].sort((a, b) => {
    const pa = product(a);
    const pb = product(b);
    if (pa !== pb) return pb - pa;
    return djb2(sha + a.card) - djb2(sha + b.card);
  });
}

/** Build a void `SpreadPosition` at a 1-based index with the given label. */
function voidPosition(
  position: number,
  label: string,
  description: string = VOID_DESCRIPTION,
): SpreadPosition {
  return { position, label, draw: null, description };
}

/** Build a filled `SpreadPosition` at a 1-based index for the given draw. */
function filledPosition(
  position: number,
  label: string,
  draw: CardDraw,
): SpreadPosition {
  return { position, label, draw };
}

/**
 * Find the first ranked draw matching `predicate` that has not yet been placed.
 * Returns `undefined` when no eligible candidate remains.
 */
function pickFirst(
  ranked: readonly CardDraw[],
  placed: ReadonlySet<CardId>,
  predicate: (draw: CardDraw) => boolean,
): CardDraw | undefined {
  return ranked.find((d) => !placed.has(d.card) && predicate(d));
}

/** Find the first drawn card with the exact `card` id that is still available. */
function pickCard(
  ranked: readonly CardDraw[],
  placed: ReadonlySet<CardId>,
  card: CardId,
): CardDraw | undefined {
  return pickFirst(ranked, placed, (d) => d.card === card);
}

/**
 * Assign a set of card draws into the positional layout of a spread.
 *
 * Pure and deterministic: the same `(draws, kind, sha)` triple always produces
 * an identical `SpreadPosition[]` (R17.8). Cards are placed by `severity ×
 * weight` with a djb2 SHA-seeded tiebreak (R17.5); positions without a
 * candidate receive the void sentinel (R17.6); no `CardId` appears in more than
 * one position (R17.7).
 */
export function assignSpread(
  draws: CardDraw[],
  kind: SpreadKind,
  sha: string,
): SpreadPosition[] {
  const ranked = rankDraws(draws, sha);
  const placed = new Set<CardId>();

  switch (kind) {
    case "fates":
      return assignFates(ranked, draws, placed);
    case "necropsy":
      return assignNecropsy(ranked, placed);
    case "celtic":
      return assignCeltic(ranked, placed);
  }
}

/**
 * Fates (3): Past, Present, Future.
 * - Present = most severe (highest `severity × weight`, SHA tiebreak).
 * - Past = prefer `hanged_man`, then `temperance`, then earliest-drawn.
 * - Future = prefer `tower`, then `devil`, then next-highest `severity × weight`.
 */
function assignFates(
  ranked: readonly CardDraw[],
  inputOrder: readonly CardDraw[],
  placed: Set<CardId>,
): SpreadPosition[] {
  // Present (pos 2): most severe current affliction (highest severity × weight,
  // SHA tiebreak) — the first entry of the ranked list that is still available.
  const present = pickFirst(ranked, placed, () => true);
  if (present) placed.add(present.card);

  // Past (pos 1): prefer `hanged_man`, then `temperance`, then the
  // earliest-drawn remaining card. "Earliest-drawn" is the original input
  // order, so the final fallback scans `inputOrder` rather than the
  // score-ranked list.
  const past =
    pickCard(ranked, placed, "hanged_man") ??
    pickCard(ranked, placed, "temperance") ??
    pickFirst(inputOrder, placed, () => true);
  if (past) placed.add(past.card);

  // Future (pos 3): tower → devil → next-highest severity × weight.
  const future =
    pickCard(ranked, placed, "tower") ??
    pickCard(ranked, placed, "devil") ??
    pickFirst(ranked, placed, () => true);
  if (future) placed.add(future.card);

  return [
    past ? filledPosition(1, "Past", past) : voidPosition(1, "Past"),
    present
      ? filledPosition(2, "Present", present)
      : voidPosition(2, "Present"),
    future ? filledPosition(3, "Future", future) : voidPosition(3, "Future"),
  ];
}

/**
 * Necropsy (5): The Corpse, The Wound, The Shadow, The Hope, The Call.
 * - Corpse = GLOBAL highest `severity × weight` (SHA tiebreak), ALWAYS (R17.3 /
 *   P6, non-negotiable). Wound = second highest.
 * - Shadow = `devil` if drawn and not already placed, otherwise third highest.
 * - Hope = `star` if drawn, otherwise void.
 * - Call = `judgement` ONLY if drawn, its registry `linkedGrimoireIds.length >
 *   0`, AND it is still unplaced after Corpse/Wound/Shadow assignment;
 *   otherwise void with the "no ritual can be performed" description.
 *
 * R17.7 / R17.3 reconciliation: The Corpse always anchors the global top draw,
 * so a high-scoring `judgement` is consumed by The Corpse and CANNOT also echo
 * into The Call (that would place one CardId twice — an R17.7 violation).
 * Every placement below is guarded by the `placed` Set and records its draw via
 * `placed.add`, so no card is ever assigned to two positions. The Call only
 * holds `judgement` when it survives the higher-priority slots unplaced.
 */
function assignNecropsy(
  ranked: readonly CardDraw[],
  placed: Set<CardId>,
): SpreadPosition[] {
  // The Hope is reserved first (design.md necropsy table): `star` is bound to
  // The Hope and must not be consumed by the greedy Corpse/Wound/Shadow slots.
  const hope = pickCard(ranked, placed, "star");
  if (hope) placed.add(hope.card);

  // The Corpse = the global highest-ranked unplaced draw, unconditionally.
  const corpse = pickFirst(ranked, placed, () => true);
  if (corpse) placed.add(corpse.card);

  // The Wound = the next highest-ranked unplaced draw.
  const wound = pickFirst(ranked, placed, () => true);
  if (wound) placed.add(wound.card);

  // The Shadow = `devil` when drawn and still unplaced, else the next
  // highest-ranked unplaced draw.
  const shadow =
    pickCard(ranked, placed, "devil") ?? pickFirst(ranked, placed, () => true);
  if (shadow) placed.add(shadow.card);

  // The Call = `judgement` only when drawn, linked to at least one grimoire,
  // and still unplaced after the slots above. Otherwise void ("no ritual").
  const judgementLinked =
    (CARD_REGISTRY.get("judgement")?.linkedGrimoireIds.length ?? 0) > 0;
  const call = judgementLinked
    ? pickCard(ranked, placed, "judgement")
    : undefined;
  if (call) placed.add(call.card);

  return [
    corpse
      ? filledPosition(1, "The Corpse", corpse)
      : voidPosition(1, "The Corpse"),
    wound ? filledPosition(2, "The Wound", wound) : voidPosition(2, "The Wound"),
    shadow
      ? filledPosition(3, "The Shadow", shadow)
      : voidPosition(3, "The Shadow"),
    hope ? filledPosition(4, "The Hope", hope) : voidPosition(4, "The Hope"),
    call
      ? filledPosition(5, "The Call", call)
      : voidPosition(5, "The Call", NO_RITUAL_DESCRIPTION),
  ];
}

/**
 * Celtic Cross (10): assign greedily by `severity × weight` (SHA tiebreak) to
 * positions in label order; empty positions receive the void sentinel.
 */
function assignCeltic(
  ranked: readonly CardDraw[],
  placed: Set<CardId>,
): SpreadPosition[] {
  const positions: SpreadPosition[] = [];
  for (let i = 0; i < CELTIC_LABELS.length; i++) {
    const label = CELTIC_LABELS[i]!;
    const candidate = pickFirst(ranked, placed, () => true);
    if (candidate) {
      placed.add(candidate.card);
      positions.push(filledPosition(i + 1, label, candidate));
    } else {
      positions.push(voidPosition(i + 1, label));
    }
  }
  return positions;
}
