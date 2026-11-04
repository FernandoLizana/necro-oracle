// apps/web — Reading_Route SPIKE (task 1.2, Q8b).
//
// This is a *minimal, throwaway* handler whose only purpose is the Q8 spike:
// prove that the tree-sitter-python grammar WASM (and the web-tree-sitter
// runtime WASM) resolve at runtime inside the Next/Vercel server build, i.e.
// that `createRequire(import.meta.url).resolve("tree-sitter-python/...wasm")`
// inside @necro/oracle does NOT throw once the function is bundled/traced.
//
// It imports `runReading` from the main (Node-side) `@necro/oracle` entry and
// drives the real tree-sitter parser against a tiny in-memory Python snapshot.
// It takes NO request body and talks to NO network. The full streaming
// Reading_Route (NDJSON, budgets, limiter, composition root) is built later in
// tasks 19-26 and REPLACES this file. Marked clearly as a spike so it is not
// mistaken for the real route.
//
// Requirements exercised by the spike: R16.2 (Node runtime + WASM resolvable),
// R16.6 (server-only import of the oracle main entry).

import {
  buildSnapshotFromFileMap,
  initParser,
  parsePython,
  hasLegacyPythonNodes,
  runReading,
} from "@necro/oracle";

// The reading pipeline parses Python and loads the grammar, so it must run on
// the Node.js runtime (not Edge). This matches R6.11 for the real route.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  // 1) Prove the grammar WASM resolves and the parser initialises. This is the
  //    exact path that fails with a `createRequire(...).resolve` error when the
  //    oracle gets bundled into the server instead of externalised + traced.
  await initParser();
  const tree = parsePython("print 'hello from the crypt'\n");
  const legacy = hasLegacyPythonNodes(tree);
  tree.delete();

  // 2) Prove the full reading orchestrator runs end to end on a tiny snapshot.
  const snapshot = buildSnapshotFromFileMap(
    {
      owner: "graveyard",
      name: "spike",
      sha: "0".repeat(40),
      defaultBranch: "main",
    },
    {
      "legacy.py": "print 'hello'\nexcept Exception, e:\n    pass\n",
      "README.md": "# spike fixture\n",
    },
    { createdAt: "2026-01-15T12:00:00.000Z" },
  );
  const reading = await runReading(snapshot, {
    spreadKind: "fates",
    now: "2026-01-15T12:00:00.000Z",
  });

  return Response.json(
    {
      spike: "wasm-resolution",
      legacyDetected: legacy,
      drawCount: reading.draws.length,
      vitality: reading.vitality,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
