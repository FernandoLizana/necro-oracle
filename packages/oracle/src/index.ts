// @necro/oracle — deck registry, detectors, spreads, vitality (pure, no adapters)
//
// This is the browser-safe main entry. It must never import Node `fs` APIs or
// the Node-only `src/node.ts` builder — those are reachable only via the
// "./node" subpath export.
export const ORACLE_VERSION = "0.0.0";

export {
  buildSnapshotFromFileMap,
  type SnapshotFromFileMapOpts,
} from "./snapshot/builder-file-map.js";
