// @necro/oracle/node — Node-only entry point.
//
// This entry exists so the main `@necro/oracle` bundle (src/index.ts) stays
// free of Node.js `fs` imports and remains browser-safe (R2.3, R21.7).
//
// It re-exports the Node-only directory snapshot builder. This is the ONLY
// place `buildSnapshotFromDirectory` is exported — it must never be re-exported
// from src/index.ts, which would pull `node:fs` into the browser-safe bundle.
export {
  buildSnapshotFromDirectory,
  type SnapshotFromFileMapOpts,
} from "./snapshot/builder-directory.js";
