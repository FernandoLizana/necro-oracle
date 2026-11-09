// @necro/oracle — Client_Safe_Entry (the "./client" subpath export).
//
// This is the single browser-safe entry the terminal web bundle and
// `@necro/ui-crt` are permitted to import from `@necro/oracle` (R16.3, R16.4).
// It re-exports ONLY zod schemas, their inferred types, the card registry and
// the typed error — nothing that pulls in a Node, tree-sitter, OSV/TOML or any
// other non-browser-safe dependency.
//
// Its static import closure is locked to exactly:
//   { registry/schema, registry/cards, snapshot/types, reading/schema,
//     util/errors }  (+ the sole bare import `zod`)
// and is enforced by `src/client.guard.test.ts` (source level) and a second
// guard over `dist/client.js` after build. Do NOT add any export here whose
// module reaches outside that allowlist.
//
// _Requirements: R16.3, R16.5_

// --- Core primitive schemas and inferred types (registry/schema) ----------
export {
  CardIdSchema,
  SeveritySchema,
  EvidenceSchema,
  CardDefinitionSchema,
  CardDrawSchema,
  SpreadPositionSchema,
  type CardId,
  type Severity,
  type Evidence,
  type CardDefinition,
  type CardDraw,
  type SpreadPosition,
} from "./registry/schema.js";

// --- Card registry (registry/cards): numerals and names for headings ------
export { CARD_REGISTRY, getCard } from "./registry/cards.js";

// --- Repository reference schema and type (snapshot/types) ----------------
export { RepoRefSchema, type RepoRef } from "./snapshot/types.js";

// --- Reading shape (reading/schema) ---------------------------------------
export {
  SpreadKindSchema,
  ReadingSchema,
  type SpreadKind,
  type Reading,
} from "./reading/schema.js";

// --- Typed errors (util/errors) -------------------------------------------
export {
  NecroError,
  NecroErrorCodeSchema,
  type NecroErrorCode,
} from "./util/errors.js";

// --- Tarot deck + draw (tarot) --------------------------------------------
// A SEPARATE 22-card Major-Arcana deck from the 12 diagnosis cards: a playful
// destiny divination drawn at random (crypto-backed live, seeded for demo),
// never added to the diagnosis registry.
export {
  TAROT_CARD_IDS,
  TAROT_DECK,
  TarotCardIdSchema,
  TarotCardSchema,
  getTarotCard,
  type TarotCardId,
  type TarotCard,
} from "./tarot/deck.js";
export {
  TAROT_POSITIONS,
  TarotOrientationSchema,
  TarotDrawCardSchema,
  TarotDrawSchema,
  drawTarot,
  cryptoRandomFn,
  seededRandomFn,
  type RandomFn,
  type TarotPosition,
  type TarotOrientation,
  type TarotDrawCard,
  type TarotDraw,
} from "./tarot/draw.js";

// --- Tarot reading text (tarot/reading) -----------------------------------
export {
  TAROT_MAX_OUTPUT_TOKENS,
  TarotReadingSchema,
  boundReading,
  buildTarotPrompt,
  fallbackReading,
  sanitizeQuestion,
  type TarotReading,
} from "./tarot/reading.js";
