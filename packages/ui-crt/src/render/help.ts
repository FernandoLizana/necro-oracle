// Help renderer for @necro/ui-crt (task 9.2).
//
// Validates: Requirements R4.1, R4.2, R4.3
//
// `renderHelp` is a pure function of nothing: it reads no port, makes no
// network/clock/DOM call, and returns a single oracle block built from static
// copy (R4.3). It lists the core commands — each with its argument form and a
// one-line description — and the keyboard shortcuts (R4.1, R4.2). Two calls are
// byte-for-byte equal.

import { sanitizeText } from "../text/sanitize.js";
import { wrapText } from "../text/wrap.js";
import type { BlockDraft, OutputLine } from "./blocks.js";

/** The static command reference, in display order: form + one-line summary. */
const COMMAND_LINES: readonly string[] = [
  "summon <owner/repo[#ref|@sha]>  pin a public repository",
  "read <fates|necropsy|celtic>    lay a spread for the pinned repo",
  "explain <position|card>         show the evidence behind a card",
  "resurrect [<card-or-file>]      raise the dead code the cards named",
  "help                            show this grimoire of commands",
  "clear                           clear the screen, keep the reading",
  "demo [name]                     replay a recorded reading",
  "motion <auto|on|off>            control reveal and CRT motion",
  "sound <on|off>                  toggle the spectral hum",
];

/** The static keyboard-shortcut reference. */
const SHORTCUT_LINES: readonly string[] = [
  "Enter        run the typed command",
  "Up / Down    walk the command history",
  "Ctrl+L       clear the screen",
  "Escape       skip the current reveal",
  "Ctrl+C       abort the running summon or reading",
];

/** Build wrapped `OutputLine`s of sanitised plain text. */
function textLines(text: string): OutputLine[] {
  return wrapText(sanitizeText(text)).map((line) => ({
    segments: [{ text: line }],
  }));
}

/**
 * Render the static help block. Identical on every call; depends on no port.
 */
export function renderHelp(): BlockDraft {
  const lines: OutputLine[] = [];
  lines.push(...textLines("The grimoire opens. These are the words of power."));
  lines.push(...textLines("COMMANDS"));
  for (const command of COMMAND_LINES) {
    lines.push(...textLines(command));
  }
  lines.push(...textLines("KEYS"));
  for (const shortcut of SHORTCUT_LINES) {
    lines.push(...textLines(shortcut));
  }
  return { kind: "oracle", demo: false, lines };
}
