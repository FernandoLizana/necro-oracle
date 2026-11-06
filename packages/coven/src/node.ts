// @necro/coven — the Node-only entry (design: "Demo mode").
//
// This is the ONLY place the Node-only Demo_Mode fixture loader is exported. It
// reads the graveyard fixtures from disk (`node:fs/promises`), so it must never
// be re-exported from `src/index.ts`, which would pull `node:fs` into the
// browser-safe barrel. Consumers that run in Node (the web route's composition
// root, the CLI) import it from `@necro/coven/node`; the browser-safe demo
// helpers (`[DEMO]` prefix, demo ports, the typed demo error) remain on the
// main barrel.
export {
  loadDemoRitualInput,
  LICH_PY2_FIXTURE,
  type LoadDemoRitualInputOptions,
} from "./demo/load-fixture.js";
