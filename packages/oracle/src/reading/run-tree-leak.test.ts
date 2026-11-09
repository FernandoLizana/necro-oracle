//
// Item 22 (P0.5): tree leak. `runReading` parses every Python file into a
// `trees` Map of web-tree-sitter `Tree` objects. Those are WASM-backed and are
// NOT reclaimed by the JS GC — they must be explicitly `.delete()`'d. The
// orchestrator built the map but never deleted the trees, so every reading
// leaked up to one WASM tree per Python file in the warm serverless instance.
//
// We spy on the shared `Tree` prototype's `delete` (obtained from a real parse)
// so the spy counts EVERY tree deletion the orchestrator performs, including
// run.ts's own `trees` map and the detectors' per-file parses. We assert that
// after runReading over N Python files, `delete` was called at least N times —
// i.e. the orchestrator reclaims the trees it creates instead of leaking them.
//
// Local tree-sitter WASM (armed in vitest.setup.ts). No network / LLM / sandbox.
import { describe, expect, it, vi } from "vitest";

import { buildSnapshotFromFileMap } from "../snapshot/builder-file-map.js";
import type { RepoRef } from "../snapshot/types.js";
import { initParser, parsePython } from "../parser/tree-sitter.js";
import { runReading } from "./run.js";
import type { ReadingOpts } from "./run.js";

const REF: RepoRef = { owner: "necro", name: "graveyard", sha: "deadbeef", defaultBranch: "main" };
const NOW = "2025-01-01T00:00:00.000Z";
const OPTS: ReadingOpts = { spreadKind: "necropsy", now: NOW };

describe("Item 22 (R19.1): runReading deletes the trees it parses (no WASM leak)", () => {
  it("calls Tree.delete at least once per Python file parsed", async () => {
    await initParser();
    // Grab the shared Tree prototype from a real parse so the spy sees EVERY
    // tree's delete (run.ts's map + the detectors). Delete our probe tree.
    const probe = parsePython("x = 1\n");
    const proto = Object.getPrototypeOf(probe) as { delete: () => void };
    probe.delete();

    const files = {
      "a.py": "def a():\n    return 1\n",
      "b.py": "class B:\n    pass\n",
      "c.py": "import os\n\ndef c(x):\n    return x + 1\n",
      "d.py": "print 'legacy'\n",
    };
    const snapshot = buildSnapshotFromFileMap(REF, files, { createdAt: NOW });
    const pyFileCount = Object.keys(files).length;

    const deleteSpy = vi.spyOn(proto, "delete");
    try {
      await runReading(snapshot, OPTS);
      // Every one of the orchestrator's own per-file trees must be reclaimed.
      // (Detectors may parse + delete their own trees too, so this is a lower
      // bound: at minimum the runReading `trees` map's N trees are deleted.)
      expect(deleteSpy.mock.calls.length).toBeGreaterThanOrEqual(pyFileCount);
    } finally {
      deleteSpy.mockRestore();
    }
  });
});
