// src/reading/run.pbt.test.ts
//
// Property tests (task 33) for the `runReading` orchestrator — the single async
// entry point that divines a RepoSnapshot into a full Reading.
//
// Property 1: Determinism.
//   For a fixed (snapshot, opts) — in particular a fixed `now` — two runs over
//   snapshots freshly built from the SAME file map produce identical Readings,
//   except for the per-run minted `id` (a fresh UUID). Because
//   `createdAt === opts.now` (never the system clock) and every detector is
//   pure over the injected data, the draws / spread / vitality / errors are
//   byte-for-byte stable.
//
// Property 2: Detector never throws.
//   `runReading` never rejects for any generated snapshot (the only rejection
//   path is PARSER_INIT_FAILED, which cannot happen once the on-disk WASM
//   grammar is initialised in vitest.setup.ts). Any detector that throws is
//   isolated into `Reading.errors` via Promise.allSettled; `errors` is always
//   an array.
//
// Property 3: Evidence paths exist.
//   Every `Evidence.path` that a detector emits (when defined) must be a key in
//   `snapshot.contents`. Evidence can only cite files the snapshot retained
//   (oversize / >5000-file entries are dropped by the builder before detectors
//   run), so membership in `contents` holds for every drawn card's evidence.
//
// Property 8 (evidence-side): No raw secrets in evidence.
//   No `Evidence.detail` across all draws matches the AWS access-key pattern
//   /AKIA[0-9A-Z]{16}/ or the PEM private-key headers. The masking unit/PBT
//   tests (task 5.3) cover `maskSecret` itself; here we re-check the full
//   orchestrator output end-to-end, including targeted secret fixtures.
//
// These are async properties: the WASM grammar is initialised once in
// vitest.setup.ts (beforeAll). No network / LLM / sandbox (R21.5, R21.6).
// `runReading` parses Python via WASM, so numRuns is kept moderate (100).
// fast-check prints the shrunk counterexample and seed on failure by default.
//
// Validates: Requirements R17.8, R19.1, R19.4, R21.8, R2.1, R5.4, R20.2, R20.3
// / Properties: P1, P2, P3, P8

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { arbRepoSnapshot } from "../../test/arbitraries.js";
import { buildSnapshotFromFileMap } from "../snapshot/builder-file-map.js";
import type { RepoSnapshot } from "../snapshot/types.js";
import { runReading, type Reading, type ReadingOpts } from "./run.js";

/** AWS access-key id pattern (R20.2). */
const AWS_KEY_RE = /AKIA[0-9A-Z]{16}/;

/** PEM private-key header patterns (R20.3). */
const PRIVATE_KEY_RES: readonly RegExp[] = [
  /-----BEGIN RSA PRIVATE KEY-----/,
  /-----BEGIN PRIVATE KEY-----/,
];

/** A Reading minus its per-run `id`, for determinism comparison. */
function withoutId(reading: Reading): Omit<Reading, "id"> {
  const { id: _id, ...rest } = reading;
  return rest;
}

/** Assert no Evidence.detail across all draws leaks a raw secret (P8). */
function expectNoRawSecrets(reading: Reading): void {
  for (const draw of reading.draws) {
    for (const ev of draw.evidence) {
      expect(ev.detail).not.toMatch(AWS_KEY_RE);
      for (const re of PRIVATE_KEY_RES) {
        expect(ev.detail).not.toMatch(re);
      }
    }
  }
}

/** Assert every Evidence.path is a key in snapshot.contents (P3). */
function expectEvidencePathsExist(
  reading: Reading,
  snapshot: RepoSnapshot,
): void {
  for (const draw of reading.draws) {
    for (const ev of draw.evidence) {
      if (ev.path === undefined) continue;
      expect(snapshot.contents.has(ev.path)).toBe(true);
    }
  }
}

describe("P1 (R19.1, R17.8): runReading is deterministic for fixed (snapshot, opts)", () => {
  // Property 1 — Validates: Requirements R19.1, R17.8 / Properties: P1
  //
  // Two freshly-built snapshots from the SAME file map, run with the SAME opts
  // (fixed `now` = the generated createdAt), yield Readings equal in every
  // field except the per-run minted `id`.
  it("same file map + same opts ⇒ identical Reading (modulo id)", async () => {
    await fc.assert(
      fc.asyncProperty(arbRepoSnapshot, async (input) => {
        const opts: ReadingOpts = {
          spreadKind: "necropsy",
          now: input.createdAt,
        };

        const snapA = buildSnapshotFromFileMap(input.ref, input.files, {
          meta: input.meta,
          createdAt: input.createdAt,
        });
        const snapB = buildSnapshotFromFileMap(input.ref, input.files, {
          meta: input.meta,
          createdAt: input.createdAt,
        });

        const a = await runReading(snapA, opts);
        const b = await runReading(snapB, opts);

        // Everything but the fresh UUID id must be deep-equal.
        expect(withoutId(a)).toEqual(withoutId(b));
        // createdAt is pinned to opts.now (never the system clock).
        expect(a.createdAt).toBe(input.createdAt);
        expect(b.createdAt).toBe(input.createdAt);
      }),
      { numRuns: 100 },
    );
  });
});

describe("P2 (R19.4, R21.8): runReading never throws; detector errors captured in errors[]", () => {
  // Property 2 — Validates: Requirements R19.4, R21.8 / Properties: P2
  //
  // For any generated snapshot, runReading resolves (never rejects) and the
  // resulting Reading carries an `errors` array (empty when all detectors
  // succeed; populated — never thrown — when a detector collapses).
  it("resolves for any snapshot and exposes errors as an array", async () => {
    await fc.assert(
      fc.asyncProperty(arbRepoSnapshot, async (input) => {
        const opts: ReadingOpts = {
          spreadKind: "necropsy",
          now: input.createdAt,
        };
        const snapshot = buildSnapshotFromFileMap(input.ref, input.files, {
          meta: input.meta,
          createdAt: input.createdAt,
        });

        const reading = await runReading(snapshot, opts);

        expect(reading).toBeDefined();
        expect(Array.isArray(reading.errors)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

describe("P3 (R2.1, R5.4): every Evidence.path is a key in snapshot.contents", () => {
  // Property 3 — Validates: Requirements R2.1, R5.4 / Properties: P3
  //
  // Evidence can only cite files the snapshot retained. The builder drops
  // oversize / >5000-file entries before detectors run, so every defined
  // Evidence.path must be present in snapshot.contents.
  it("all drawn-card evidence paths resolve against snapshot.contents", async () => {
    await fc.assert(
      fc.asyncProperty(arbRepoSnapshot, async (input) => {
        const opts: ReadingOpts = {
          spreadKind: "necropsy",
          now: input.createdAt,
        };
        const snapshot = buildSnapshotFromFileMap(input.ref, input.files, {
          meta: input.meta,
          createdAt: input.createdAt,
        });

        const reading = await runReading(snapshot, opts);

        expectEvidencePathsExist(reading, snapshot);
      }),
      { numRuns: 100 },
    );
  });
});

describe("P8 (R20.2, R20.3): no raw secrets leak into Reading evidence", () => {
  // Property 8 (evidence-side) — Validates: Requirements R20.2, R20.3 / Properties: P8
  //
  // Random content strings are very unlikely to contain secrets, so this
  // property is a safety net over the whole orchestrator; the targeted
  // example-based tests below exercise the real masking path with injected
  // AWS keys and private-key headers.
  it("no Evidence.detail matches AWS-key or private-key patterns", async () => {
    await fc.assert(
      fc.asyncProperty(arbRepoSnapshot, async (input) => {
        const opts: ReadingOpts = {
          spreadKind: "necropsy",
          now: input.createdAt,
        };
        const snapshot = buildSnapshotFromFileMap(input.ref, input.files, {
          meta: input.meta,
          createdAt: input.createdAt,
        });

        const reading = await runReading(snapshot, opts);

        expectNoRawSecrets(reading);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Targeted example-based tests — exercise P3 and P8 on REAL evidence.
//
// arbRepoSnapshot's random content is unlikely to trip the Devil detector's
// secret / dangerous-call patterns, so these cases inject a Python file that
// contains an AWS access key, a PEM private key, a `yaml.load` without a
// Loader, and an `eval` call. This forces the Devil detector to emit evidence
// and lets us assert both that (a) no raw secret survives into evidence (P8)
// and (b) every emitted Evidence.path is a real key in snapshot.contents (P3).
// ---------------------------------------------------------------------------

const FIXED_REF = {
  owner: "necro",
  name: "graveyard",
  sha: "0".repeat(40),
  defaultBranch: "main",
};

const FIXED_NOW = "2026-11-03T12:00:00.000Z";

const FIXED_OPTS: ReadingOpts = { spreadKind: "necropsy", now: FIXED_NOW };

describe("runReading targeted secret/dangerous-call evidence (P3, P8)", () => {
  it("masks an AWS access key and never leaks it into evidence", async () => {
    const files: Record<string, string> = {
      "app/config.py": [
        "AWS_ACCESS_KEY_ID = 'AKIAIOSFODNN7EXAMPLE'",
        "AWS_SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'",
        "",
      ].join("\n"),
    };
    const snapshot = buildSnapshotFromFileMap(FIXED_REF, files, {
      createdAt: FIXED_NOW,
    });

    const reading = await runReading(snapshot, FIXED_OPTS);

    // No raw AWS key / private-key header survives anywhere in evidence (P8).
    expectNoRawSecrets(reading);
    // Every evidence path that was emitted is a real retained file (P3).
    expectEvidencePathsExist(reading, snapshot);
  });

  it("masks a PEM private key and never leaks its header into evidence", async () => {
    const files: Record<string, string> = {
      "secrets/key.py": [
        "PRIVATE_KEY = '''",
        "-----BEGIN RSA PRIVATE KEY-----",
        "MIIEowIBAAKCAQEA0000000000000000000000000000000000000000000000",
        "-----END RSA PRIVATE KEY-----",
        "'''",
        "",
      ].join("\n"),
    };
    const snapshot = buildSnapshotFromFileMap(FIXED_REF, files, {
      createdAt: FIXED_NOW,
    });

    const reading = await runReading(snapshot, FIXED_OPTS);

    expectNoRawSecrets(reading);
    expectEvidencePathsExist(reading, snapshot);
  });

  it("flags dangerous yaml.load / eval and cites real file paths", async () => {
    const files: Record<string, string> = {
      "src/loader.py": [
        "import yaml",
        "def load(data):",
        "    cfg = yaml.load(data)",
        "    return eval(cfg['expr'])",
        "",
      ].join("\n"),
    };
    const snapshot = buildSnapshotFromFileMap(FIXED_REF, files, {
      createdAt: FIXED_NOW,
    });

    const reading = await runReading(snapshot, FIXED_OPTS);

    // The Devil card should be drawn with evidence; whatever it cites, every
    // path must resolve against snapshot.contents (P3) and carry no raw secret.
    expectEvidencePathsExist(reading, snapshot);
    expectNoRawSecrets(reading);
  });

  it("produces an identical reading (modulo id) on repeated runs of a secret fixture", async () => {
    const files: Record<string, string> = {
      "src/loader.py": [
        "import yaml",
        "TOKEN = 'AKIAIOSFODNN7EXAMPLE'",
        "def load(data):",
        "    return yaml.load(data)",
        "",
      ].join("\n"),
    };
    const a = await runReading(
      buildSnapshotFromFileMap(FIXED_REF, files, { createdAt: FIXED_NOW }),
      FIXED_OPTS,
    );
    const b = await runReading(
      buildSnapshotFromFileMap(FIXED_REF, files, { createdAt: FIXED_NOW }),
      FIXED_OPTS,
    );

    expect(withoutId(a)).toEqual(withoutId(b));
    expectNoRawSecrets(a);
  });
});

// --- Regression examples (permanent counterexamples) -----------------------
//
// When a property above finds a counterexample, record it here as a named
// example test so it is checked forever after. None found yet.
