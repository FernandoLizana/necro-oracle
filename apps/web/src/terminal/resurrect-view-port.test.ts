// apps/web/src/terminal/resurrect-view-port.test.ts
//
// Feature: oracle-landing-polish, task 11.3 — unit test for the resurrection
// result-view port (design.md §"apps/web: resurrection-view port"; Part B bug
// 2, R9.1, R9.6, R9.7).
//
// This test pins the WIRING contract that keeps the heavy `ResurrectionResult`
// diff/vitality/patch view out of the terminal initial route and in its own
// lazily-loaded chunk:
//
//   R9.1 — `createResurrectViewPort()` returns a function, and calling that
//          function returns a Promise (the lazy loader). `createBrowserPorts()`
//          exposes that same port under the `resurrectView` key, so the single
//          live reference keeps `load-resurrection-view.ts` reachable from the
//          module graph and the bundler emits the distinct chunk.
//
//   R9.6/R9.7 — the budget script's chunk-location contract still holds:
//          `findSeparateChunks(...)` locates a `ResurrectionResult.<hash>.js`
//          entry as a distinct, non-null resurrection chunk, and returns null
//          when no such chunk is present. (The full initial-route exclusion
//          and gzip-budget assertions live in `budget.test.ts`; this is the
//          focused, non-redundant restatement that the wiring under test keeps
//          the chunk locatable.)
//
// Everything runs OFFLINE with no network / LLM / sandbox. The port's returned
// value is asserted to be a Promise WITHOUT awaiting its resolution: calling
// the port triggers a dynamic import of `../components/ResurrectionResult.js`,
// which may not resolve in the node/jsdom test env — the chunk-emission itself
// is verified by the build-time budget gate, not here.
//
// Validates: Requirements 9.1, 9.6, 9.7

import { describe, expect, it } from "vitest";

import { createBrowserPorts } from "./browser-ports.js";
import { createResurrectViewPort } from "./resurrect-view-port.js";

// The budget script lives at the repo root under scripts/. It is loaded lazily
// via the same SCRIPT_URL dynamic import that `budget.test.ts` uses, so this
// test exercises the real `findSeparateChunks` helper offline.
const SCRIPT_URL = new URL("../../../../scripts/check-web-budget.mjs", import.meta.url);

type SeparateChunks = {
  readonly demo: string | null;
  readonly sound: string | null;
  readonly resurrection: string | null;
  readonly backgroundTheme: string | null;
};

async function loadFindSeparateChunks(): Promise<
  (chunkNames: readonly string[]) => SeparateChunks
> {
  const mod = (await import(SCRIPT_URL.href)) as Record<string, unknown>;
  return mod["findSeparateChunks"] as (chunkNames: readonly string[]) => SeparateChunks;
}

// ===========================================================================
// R9.1 — the live port is a lazy loader and is wired into createBrowserPorts
// ===========================================================================

describe("createResurrectViewPort — the lazy resurrection-view loader (R9.1)", () => {
  it("returns a function whose call yields a Promise (without requiring resolution)", () => {
    const port = createResurrectViewPort();
    expect(typeof port).toBe("function");

    // Calling the port triggers a dynamic import of ResurrectionResult, which
    // may or may not resolve under node/jsdom — assert only that the RETURN is
    // a Promise, and swallow any rejection so an unresolved import can't make
    // the test flaky or log an unhandled rejection.
    const pending = port();
    expect(pending).toBeInstanceOf(Promise);
    void pending.catch(() => {
      // Chunk resolution is verified by the build-time budget gate, not here.
    });
  });
});

describe("createBrowserPorts — the resurrectView wiring (R9.1)", () => {
  it("exposes a resurrectView port that is a function returning a Promise", () => {
    const ports = createBrowserPorts();

    // The key presence is the wiring that makes the ResurrectionResult chunk
    // emit: the single live reference keeps the loader in the module graph.
    expect(ports).toHaveProperty("resurrectView");
    const resurrectView = ports.resurrectView;
    expect(typeof resurrectView).toBe("function");

    const pending = resurrectView!();
    expect(pending).toBeInstanceOf(Promise);
    void pending.catch(() => {
      // See above: resolution is not required for this wiring assertion.
    });
  });
});

// ===========================================================================
// R9.6/R9.7 — the budget script still locates the resurrection chunk
// ===========================================================================

describe("findSeparateChunks — the resurrection chunk stays locatable (R9.6, R9.7)", () => {
  it("locates a ResurrectionResult.<hash>.js entry as a distinct, non-null resurrection chunk", async () => {
    const findSeparateChunks = await loadFindSeparateChunks();

    const RESURRECTION_CHUNK = "static/chunks/ResurrectionResult.<hash>.js";
    const chunkNames = [
      "static/chunks/webpack-aaa.js",
      "static/chunks/app/page-eee.js",
      RESURRECTION_CHUNK,
    ];

    const { resurrection } = findSeparateChunks(chunkNames);
    expect(resurrection).not.toBeNull();
    expect(resurrection).toBe(RESURRECTION_CHUNK);
  });

  it("returns null for the resurrection chunk when no such chunk is present", async () => {
    const findSeparateChunks = await loadFindSeparateChunks();

    const onlyInitial = [
      "static/chunks/webpack-aaa.js",
      "static/chunks/app/page-eee.js",
    ];

    const { resurrection } = findSeparateChunks(onlyInitial);
    expect(resurrection).toBeNull();
  });
});
