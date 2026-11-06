// Canonical printer for the CRT Terminal command union.
//
// Validates: Requirements R2.7, R2.8, R2.14, R2.15
//
// `printCommand` renders every non-`unknown` {@link Command} to its canonical
// text form: the lowercase command name followed by single-space-separated
// arguments, using the stored (already lowercase) argument values. The result
// re-parses to an equal Command (round-trip, P1). Pure: no side effects.

import type { Command } from "./types.js";

/** Render a non-`unknown` {@link Command} to its canonical entry text. */
export function printCommand(cmd: Exclude<Command, { kind: "unknown" }>): string {
  switch (cmd.kind) {
    case "help":
      return "help";
    case "clear":
      return "clear";
    case "summon":
      return `summon ${cmd.repo}`;
    case "read":
      return `read ${cmd.spread}`;
    case "explain":
      return cmd.target.kind === "position"
        ? `explain ${cmd.target.position}`
        : `explain ${cmd.target.card}`;
    case "resurrect": {
      const { target } = cmd;
      switch (target.kind) {
        case "bare":
          return "resurrect";
        case "card":
          return `resurrect ${target.card}`;
        case "file":
          return `resurrect ${target.path}`;
      }
    }
    case "motion":
      return cmd.arg === undefined ? "motion" : `motion ${cmd.arg}`;
    case "demo":
      return cmd.name === undefined ? "demo" : `demo ${cmd.name}`;
    case "sound":
      return cmd.arg === undefined ? "sound" : `sound ${cmd.arg}`;
  }
}
