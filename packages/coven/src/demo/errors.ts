// @necro/coven — Demo_Mode typed errors (design: "Demo mode"; R14.6).
//
// PURE, browser-safe module: it imports the models' `covenError` factory only
// (no adapters, no Node `fs`). The Node-only fixture loader
// (`demo/load-fixture.ts`) raises `demoFixtureMissingError` when a required
// `fixtures/graveyard/lich-py2` fixture is missing or unreadable, so the route
// can surface it as a terminal `Error_Line` with the canonical
// `DEMO_FIXTURE_MISSING` machine code.
//
// The `userMessage` is oracle-voice (two layers: one mystical line, then the
// actionable technical fact) and carries NO file path, secret, or stack (R12.5,
// R13.2) — the missing fixture is NOT named in the message, so a demo deploy
// with a broken fixture leaks nothing about the server's filesystem layout. The
// underlying cause is attached as `NecroError.cause` for server-side logging
// only; it never rides out on the `userMessage`.

import { covenError } from "../models.js";

/**
 * The canonical `DEMO_FIXTURE_MISSING` error for a Demo_Mode Ritual whose
 * required fixtures under `fixtures/graveyard/lich-py2` are missing or
 * unreadable (R14.6). The `cause` is attached for logging but never surfaced in
 * the oracle-voice `userMessage`.
 */
export function demoFixtureMissingError(cause?: unknown): ReturnType<typeof covenError> {
  return covenError(
    "DEMO_FIXTURE_MISSING",
    // oracle-voice: one mystical line, then the actionable technical fact.
    "The crypt the demo would raise has crumbled to dust.\n" +
      "A required demo fixture is missing or unreadable; the demo cannot run.",
    cause,
  );
}
