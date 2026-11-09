// apps/web/src/server/canary.ts
//
// SEC-10 / SEC-11: the leak canary.
//
// A fixed, recognizable sentinel string that stands in for "a secret the
// server must never leak to a client surface". It is used two ways:
//
//   1. RUNTIME (SEC-10): the canary is always added to the redaction set the
//      stream handlers apply to every outgoing line and to every logged
//      error message/stack. If any code path ever emits the canary, the
//      redaction pipeline scrubs it to [REDACTED] — proving the pipeline is
//      wired end-to-end. A runtime test plants the canary and asserts it never
//      survives to the response body or the logs.
//
//   2. BUILD (SEC-11): `scripts/check-web-budget.mjs` includes NECRO_CANARY in
//      its forbidden-marker sweep over every client `.next/static/**/*.js`
//      chunk, so a canary that ever reaches the browser bundle fails the build.
//
// This module is SERVER-ONLY. It must never be imported by client code; the
// boundary guard tests + the build sweep enforce that the canary string never
// crosses into the browser bundle. The value is NOT a real secret and carries
// no entropy — it is a marker, deliberately distinctive so a grep/scan for it
// is unambiguous.

/**
 * The leak-canary sentinel. Distinctive, secret-shaped, and never a real
 * credential. If this string appears in a client bundle (SEC-11) or survives
 * into a response/log (SEC-10), redaction or the client/server boundary
 * failed.
 */
export const NECRO_CANARY = "NECRO_CANARY_dead0beef_do_not_ship_a1b2c3d4e5f6";
