//
// Item 29a (P0.5): tests for the optional E2B SandboxPort. The provider is
// security-critical (repository code is untrusted; one micro-VM per ritual,
// destroyed in every terminal state; only the fixed allowlisted py_compile
// command ever runs; the source is written as a FILE, never interpolated into
// the command line) but had NO tests. These drive the REAL provider against a
// FAKE `e2b` SDK (injected via vi.mock) so no account / network is touched.
import { NecroError } from "@necro/oracle";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CANDIDATE_PATH, PY_COMPILE_ARGV } from "../allowlist.js";

// A controllable fake `e2b` SDK. The factory reads a module-level script so
// each test can shape create/run/kill behaviour + record the calls.
const sdk = vi.hoisted(() => ({
  created: 0,
  killed: 0,
  writes: [] as Array<{ path: string; data: string }>,
  runs: [] as string[],
  exitCode: 0,
  createThrows: false,
  runThrows: false,
}));

vi.mock("e2b", () => ({
  Sandbox: {
    create: async () => {
      if (sdk.createThrows) throw new Error("create failed");
      sdk.created += 1;
      return {
        files: {
          write: async (path: string, data: string) => {
            sdk.writes.push({ path, data });
          },
        },
        commands: {
          run: async (cmd: string) => {
            sdk.runs.push(cmd);
            if (sdk.runThrows) throw new Error("run failed");
            return { exitCode: sdk.exitCode };
          },
        },
        kill: async () => {
          sdk.killed += 1;
        },
      };
    },
  },
}));

// Imported AFTER the mock is registered (vi.mock is hoisted).
const { createE2bSandboxPort, isE2bConfigured, E2bSandboxPort } = await import(
  "./e2b.js"
);

afterEach(() => {
  sdk.created = 0;
  sdk.killed = 0;
  sdk.writes = [];
  sdk.runs = [];
  sdk.exitCode = 0;
  sdk.createThrows = false;
  sdk.runThrows = false;
  vi.clearAllMocks();
});

const UNTRUSTED = "def f():\n    return 1  # os.system('rm -rf /') not a real call\n";

describe("Item 29a: E2B SandboxPort config gating", () => {
  it("is not created without an API key (default local path, zero E2B dep)", () => {
    expect(createE2bSandboxPort(undefined)).toBeUndefined();
    expect(createE2bSandboxPort(null)).toBeUndefined();
    expect(createE2bSandboxPort({ apiKey: "   " })).toBeUndefined();
    expect(isE2bConfigured({ apiKey: "" })).toBe(false);
  });

  it("is created when an API key is present", () => {
    const port = createE2bSandboxPort({ apiKey: "e2b-key" });
    expect(port).toBeInstanceOf(E2bSandboxPort);
  });
});

describe("Item 29a: E2B SandboxPort security invariants", () => {
  it("runs ONLY the fixed allowlisted py_compile command and writes source as a FILE", async () => {
    const port = createE2bSandboxPort({ apiKey: "e2b-key" })!;
    sdk.exitCode = 0;

    const result = await port.parseCheckPython3(UNTRUSTED, { timeoutMs: 5_000 });
    expect(result.ok).toBe(true);

    // The source was delivered as a FILE at the fixed candidate path...
    expect(sdk.writes).toHaveLength(1);
    expect(sdk.writes[0]!.path).toBe(CANDIDATE_PATH);
    expect(sdk.writes[0]!.data).toBe(UNTRUSTED);

    // ...and the ONLY command run is the frozen py_compile argv joined - the
    // untrusted source is NEVER on the command line.
    expect(sdk.runs).toHaveLength(1);
    expect(sdk.runs[0]).toBe(PY_COMPILE_ARGV.join(" "));
    expect(sdk.runs[0]).not.toContain("rm -rf");
    expect(sdk.runs[0]).not.toContain("return 1");
  });

  it("maps a non-zero exit to { ok: false } (does not parse)", async () => {
    const port = createE2bSandboxPort({ apiKey: "e2b-key" })!;
    sdk.exitCode = 1;
    const result = await port.parseCheckPython3("print 'py2'\n", { timeoutMs: 5_000 });
    expect(result.ok).toBe(false);
  });

  it("destroys the micro-VM (kill) and throws UPSTREAM_UNAVAILABLE when the run fails", async () => {
    const port = createE2bSandboxPort({ apiKey: "e2b-key" })!;
    sdk.runThrows = true;
    const err = await port.parseCheckPython3(UNTRUSTED, { timeoutMs: 5_000 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NecroError);
    expect((err as NecroError).code).toBe("UPSTREAM_UNAVAILABLE");
    // Terminal state => the VM was destroyed.
    expect(sdk.killed).toBe(1);
  });

  it("reuses ONE micro-VM across checks, destroyed once on dispose", async () => {
    const port = createE2bSandboxPort({ apiKey: "e2b-key" })!;
    await port.parseCheckPython3(UNTRUSTED, { timeoutMs: 5_000 });
    await port.parseCheckPython3(UNTRUSTED, { timeoutMs: 5_000 });
    // One sandbox created and reused for both checks (one micro-VM per ritual).
    expect(sdk.created).toBe(1);
    expect(sdk.killed).toBe(0);
    await port.dispose();
    expect(sdk.killed).toBe(1);
    // dispose is idempotent-safe: a second call does not kill again.
    await port.dispose();
    expect(sdk.killed).toBe(1);
  });
});
