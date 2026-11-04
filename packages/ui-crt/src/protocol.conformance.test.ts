// Barrel + protocol conformance smoke test (TEST-FIRST).
//
// Validates: Requirements R16.3, R16.7
//
// This test proves two boundary facts the rest of @necro/ui-crt relies on:
//   1. The Client_Safe_Entry `@necro/oracle/client` resolves under Vitest and
//      yields the shapes the protocol types are built on (R16.3: the browser
//      imports the Reading shape only through the Client_Safe_Entry).
//   2. The protocol/ports surface (`SummonSummary`, `ReadingResponse`,
//      `ReadingPhase`, `ProgressEvent`, `ApiPort`, `DemoPort`, `DemoBundle`,
//      `PlayableSpread`) is importable from the package barrel `src/index.ts`
//      (R16.7: cross-package consumers use only the barrel, so every protocol
//      type must be re-exported there).
//
// It is EXPECTED to fail until task 4.2 adds `src/protocol.ts`, `src/ports.ts`
// and their barrel re-exports, and until task 2.2 declares the
// `@necro/oracle/client` subpath export. Both failure modes are meaningful:
//   - the runtime `import()` of `@necro/oracle/client` rejects when the subpath
//     is not declared, failing this test with a clear assertion message;
//   - the type-level `expectTypeOf` / `assertType` checks fail to compile when
//     the barrel does not yet re-export the protocol surface.

import { describe, expect, expectTypeOf, it } from "vitest";

// Type-only imports from the package barrel. When the barrel does not yet
// re-export these names (before task 4.2), this file fails to typecheck.
import type {
  ApiPort,
  DemoBundle,
  DemoPort,
  PlayableSpread,
  ProgressEvent,
  ReadingPhase,
  ReadingResponse,
  SummonSummary,
} from "./index.js";

describe("P (R16.3): @necro/oracle/client resolves under Vitest", () => {
  it("resolves the Client_Safe_Entry subpath at runtime", async () => {
    // Declared as a subpath export in task 2.2; until then this import()
    // rejects with ERR_PACKAGE_PATH_NOT_EXPORTED, failing the test here.
    const client = await import("@necro/oracle/client").catch((cause: unknown) => {
      throw new Error(
        "expected '@necro/oracle/client' to resolve under Vitest, " +
          "but the subpath export is not declared yet",
        { cause },
      );
    });
    expect(client).toBeTypeOf("object");
  });
});

describe("P (R16.7): the protocol/ports surface is importable from the barrel", () => {
  it("exposes SummonSummary with the summon-summary field shape", () => {
    expectTypeOf<SummonSummary>().toMatchTypeOf<{
      readonly stars: number;
      readonly hasWorkflowsDir: boolean;
      readonly degradedFields: readonly ("pulls" | "release")[];
      readonly cache: "hit" | "miss";
      readonly fileCount: number;
      readonly truncated: boolean;
    }>();
  });

  it("exposes ReadingResponse pairing a summary with a reading", () => {
    expectTypeOf<ReadingResponse>().toHaveProperty("summary").toEqualTypeOf<SummonSummary>();
    expectTypeOf<ReadingResponse>().toHaveProperty("reading");
  });

  it("exposes ReadingPhase as the four ordered phase names", () => {
    expectTypeOf<ReadingPhase>().toEqualTypeOf<"SUMMON" | "DOWNLOAD" | "EXTERNAL" | "READING">();
  });

  it("exposes ProgressEvent as the phase/skip-note union", () => {
    const phase: ProgressEvent = { kind: "phase", phase: "SUMMON" };
    const skip: ProgressEvent = { kind: "skip-note", note: "the mists hid the registries" };
    expect(phase.kind).toBe("phase");
    expect(skip.kind).toBe("skip-note");
  });

  it("exposes PlayableSpread as fates | necropsy", () => {
    expectTypeOf<PlayableSpread>().toEqualTypeOf<"fates" | "necropsy">();
  });

  it("exposes ApiPort with summon and read methods", () => {
    expectTypeOf<ApiPort>().toHaveProperty("summon").toBeFunction();
    expectTypeOf<ApiPort>().toHaveProperty("read").toBeFunction();
  });

  it("exposes DemoPort returning a DemoBundle", () => {
    expectTypeOf<DemoPort>().toHaveProperty("load").toBeFunction();
    expectTypeOf<DemoPort["load"]>().returns.resolves.toEqualTypeOf<DemoBundle>();
  });
});
