// Command types for the CRT Terminal.
//
// Validates: Requirements R2.1, R2.2, R2.3, R2.4, R2.5, R2.6, R2.11, R2.13,
// R2.14, R2.16
//
// The `Command` union is the parsed, structured form of a single terminal
// entry. It is produced by `parseCommand` (./parse.ts) and, for every variant
// except `unknown`, rendered back to its canonical text form by `printCommand`
// (./print.ts). These types are pure data: no adapters, no DOM, no clock.

import type { CardId } from "@necro/oracle/client";

/**
 * Motion preference literals. The prefs module (design §"Motion and
 * preferences") owns the canonical `MotionPreference` export; the union is
 * restated here so `command/types.ts` stays self-contained and depends only on
 * `@necro/oracle/client`.
 */
export type CommandMotionArg = "auto" | "on" | "off";

/** Sound preference literals (design §"Motion and preferences"). */
export type CommandSoundArg = "on" | "off";

/** Target of an `explain` command: a 1-based spread position or a card id. */
export type ExplainTarget =
  | { readonly kind: "position"; readonly position: number }
  | { readonly kind: "card"; readonly card: CardId };

/** The three spread names `read` accepts. */
export type SpreadArg = "fates" | "necropsy" | "celtic";

/** A single parsed terminal entry. */
export type Command =
  | { readonly kind: "help" }
  | { readonly kind: "clear" }
  | { readonly kind: "summon"; readonly repo: string }
  | { readonly kind: "read"; readonly spread: SpreadArg }
  | { readonly kind: "explain"; readonly target: ExplainTarget }
  | { readonly kind: "motion"; readonly arg?: CommandMotionArg }
  | { readonly kind: "demo"; readonly name?: string }
  | { readonly kind: "sound"; readonly arg?: CommandSoundArg }
  | { readonly kind: "unknown"; readonly raw: string };

/**
 * Maximum length of a single terminal entry (R2.13). Enforced by the Terminal
 * before parsing; exported here as the single source of truth.
 */
export const MAX_ENTRY_LENGTH = 200;
