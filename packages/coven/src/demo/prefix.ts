// @necro/coven — the Demo_Mode `[DEMO]` line prefix (design: "Demo mode";
// R14.3). PURE, browser-safe module: no adapters, no Node `fs`.
//
// In Demo_Mode every emitted stream line must carry a `[DEMO]` prefix so the
// terminal renders them verbatim and the user can never mistake a replayed
// demo for a live Ritual (R14.3). Per the design note on task 14.3 the prefix
// is applied ONCE, at the server's emit layer, so EVERY line that leaves the
// server — each Phase_Line, each Skip_Note_Line, and the single terminal
// Result_Line/Error_Line — is labelled from one choke point; the client renders
// the already-prefixed text verbatim and never adds a second prefix.
//
// The `[DEMO]` marker belongs on the SERIALIZED line, not on the phase enum the
// runner emits (the runner is demo-agnostic: it emits plain phase tokens and
// free-text skip-notes through its `PhaseEmit`). This module therefore offers
// two primitives the server composes:
//
//   - `prefixDemoLine` / `DEMO_PREFIX` — the line-level labeller the route
//     applies to EVERY serialized stream line in demo mode (phase lines, the
//     terminal line, and any line it builds itself);
//   - `demoEmit` — a thin `PhaseEmit` wrapper that labels the free-text
//     skip-notes the runner emits directly, so a route that forwards a runner
//     skip-note verbatim still gets it `[DEMO]`-marked.
//
// A route that renders phase tokens to lines itself prefixes those lines with
// `prefixDemoLine`; a route that forwards the runner's skip-notes wraps its
// `PhaseEmit` with `demoEmit`. Both paths yield one `[DEMO]` prefix per line and
// never two.

import type { PhaseEmit } from "../runners/local.js";

/** The fixed Demo_Mode line marker. Every demo stream line begins with it. */
export const DEMO_PREFIX = "[DEMO] ";

/**
 * Prefix one already-serialized stream line with the Demo_Mode marker. Applied
 * exactly once per line; the client never double-prefixes (design note, task
 * 14.3). Idempotence is NOT assumed here — callers apply it once at the single
 * serialization choke point.
 */
export function prefixDemoLine(line: string): string {
  return `${DEMO_PREFIX}${line}`;
}

/**
 * Wrap a `PhaseEmit` so the free-text skip-notes the runner emits are prefixed
 * with `[DEMO] ` before reaching the underlying sink (R14.3). Phase tokens pass
 * through unchanged — they are a fixed enum the route renders to a line, and
 * the route applies `prefixDemoLine` to that rendered line. The underlying
 * emit's return (sync or a promise) is propagated unchanged so the runner's
 * `await` semantics are preserved.
 */
export function demoEmit(emit: PhaseEmit): PhaseEmit {
  return {
    phase: (phase) => emit.phase(phase),
    skipNote: (note) => emit.skipNote(prefixDemoLine(note)),
  };
}
