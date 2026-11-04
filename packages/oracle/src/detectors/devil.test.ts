// @necro/oracle — unit tests for detectDevil (XV — Security Sins) (task 16.1).
//
// TEST-FIRST: these tests are written against the detectDevil API described in
// design.md ("detectDevil — XV The Devil") and requirements R7.1–R7.7, R20.2,
// R20.3 BEFORE the real implementation exists (task 16.2). They are EXPECTED TO
// BE RED until 16.2 replaces the throwing stub in devil.ts with the real scan.
//
// Snapshots are built with the browser-safe buildSnapshotFromFileMap (task 8.2)
// and the pre-parsed trees are produced with the real tree-sitter parser
// (parsePython), which is initialised once in vitest.setup.ts's beforeAll
// (task 10). No network access is needed (R3.1, R21.5, R21.6). Detectors read
// pre-parsed trees from opts.trees and never call parsePython themselves.
//
// Coverage map:
//   R7.1 dangerous call patterns scanned in all python files
//   R7.2 dangerous pattern in production code → severity 2, upright
//   R7.3 dangerous pattern only in test/example paths → severity 1, reversed
//   R7.4 secret-like strings detected (AWS key, private-key headers, high-entropy)
//   R7.5 secret evidence masked; raw value never stored/returned
//   R7.6 injected osvData → one kind:"osv" evidence per vulnerability
//   R7.7 nothing found + no osv → null
//   R20.2 maskSecret applied before assignment to Evidence.detail
//   R20.3 safety-net re-mask of any Evidence.detail matching AWS/private-key
//   P8 no Evidence.detail matches AWS or private-key patterns

import { describe, expect, it } from "vitest";

import { parsePython, type Tree } from "../parser/tree-sitter.js";
import { buildSnapshotFromFileMap } from "../snapshot/builder-file-map.js";
import type { RepoRef, RepoSnapshot } from "../snapshot/types.js";
import type { NecroError } from "../util/errors.js";
import type { CardDraw, Evidence } from "../registry/schema.js";
import type { DetectorOpts, OsvData } from "./types.js";

import { detectDevil } from "./devil.js";

// --- test helpers --------------------------------------------------------

const REF: RepoRef = {
  owner: "necro",
  name: "graveyard",
  sha: "deadbeef",
  defaultBranch: "main",
};

const CREATED_AT = "2025-01-01T00:00:00.000Z";
const NOW = "2025-01-01T00:00:00.000Z";

/** Secret-detection patterns mirrored from the design (for assertions only). */
const AWS_KEY_RE = /AKIA[0-9A-Z]{16}/;
const PRIVATE_KEY_RE =
  /-----BEGIN (?:RSA )?PRIVATE KEY-----/;

/** Build a snapshot from a path→content map (no fs, no clock). */
function snapshotOf(files: Record<string, string>): RepoSnapshot {
  return buildSnapshotFromFileMap(REF, files, { createdAt: CREATED_AT });
}

/**
 * Pre-parse every python file in the snapshot into opts.trees, mirroring what
 * the reading orchestrator does before calling detectors. Files that fail to
 * parse are recorded in parseErrors instead (none are expected here).
 */
function optsFor(
  snapshot: RepoSnapshot,
  extra: Partial<DetectorOpts> = {},
): DetectorOpts {
  const trees = new Map<string, Tree>();
  const parseErrors = new Map<string, NecroError>();
  for (const file of snapshot.files) {
    if (file.lang !== "python") continue;
    const source = snapshot.contents.get(file.path) ?? "";
    try {
      trees.set(file.path, parsePython(source));
    } catch (err) {
      parseErrors.set(file.path, err as NecroError);
    }
  }
  return { now: NOW, trees, parseErrors, ...extra };
}

/** Run detectDevil over a one-or-more-file map with optional osvData. */
function runDevil(
  files: Record<string, string>,
  osvData?: OsvData,
): CardDraw | null {
  const snapshot = snapshotOf(files);
  const opts = optsFor(snapshot, osvData ? { osvData } : {});
  return detectDevil(snapshot, opts);
}

/** Assert no evidence detail leaks a raw AWS key or private-key header (P8). */
function assertNoRawSecrets(evidence: readonly Evidence[]): void {
  for (const e of evidence) {
    expect(
      AWS_KEY_RE.test(e.detail),
      `evidence detail must not contain a raw AWS key: ${e.detail}`,
    ).toBe(false);
    expect(
      PRIVATE_KEY_RE.test(e.detail),
      `evidence detail must not contain a raw private-key header: ${e.detail}`,
    ).toBe(false);
  }
}

// --- R7.1 / R7.2 dangerous patterns in production code -------------------

describe("detectDevil: dangerous patterns in production code (R7.1, R7.2)", () => {
  it("draws devil at severity 2 upright when eval( appears in a prod file", () => {
    const draw = runDevil({
      "src/app.py": "def run(data):\n    return eval(data)\n",
    });
    expect(draw).not.toBeNull();
    const d = draw as CardDraw;
    expect(d.card).toBe("devil");
    expect(d.severity).toBe(2);
    expect(d.orientation).toBe("upright");
    expect(d.evidence.length).toBeGreaterThan(0);
  });

  it("includes evidence referencing the offending production file", () => {
    const draw = runDevil({
      "src/app.py": "def run(data):\n    return eval(data)\n",
    }) as CardDraw;
    const paths = draw.evidence.map((e) => e.path);
    expect(paths).toContain("src/app.py");
  });
});

// --- R7.3 dangerous patterns exclusively in test/example paths -----------

describe("detectDevil: dangerous patterns only in test/example paths (R7.3)", () => {
  it("draws devil at severity 1 reversed when eval( appears only under tests/", () => {
    const draw = runDevil({
      "tests/test_eval.py": "def test_it():\n    assert eval('1 + 1') == 2\n",
    });
    expect(draw).not.toBeNull();
    const d = draw as CardDraw;
    expect(d.card).toBe("devil");
    expect(d.severity).toBe(1);
    expect(d.orientation).toBe("reversed");
  });

  it("stays severity 2 upright when the same pattern is also in production", () => {
    const draw = runDevil({
      "tests/test_eval.py": "def test_it():\n    assert eval('1 + 1') == 2\n",
      "src/app.py": "def run(data):\n    return eval(data)\n",
    }) as CardDraw;
    expect(draw.severity).toBe(2);
    expect(draw.orientation).toBe("upright");
  });
});

// --- R7.4 / R7.5 / R20.2 secret detection + masking ----------------------

describe("detectDevil: AWS access key masking (R7.4, R7.5, R20.2)", () => {
  const AWS_KEY = "AKIAIOSFODNN7EXAMPLE"; // AKIA + 16 upper/digits
  const files = {
    "src/config.py": `AWS_ACCESS_KEY_ID = "${AWS_KEY}"\n`,
  };

  it("draws devil and masks the AWS key in evidence (first 4 chars + ****)", () => {
    const draw = runDevil(files);
    expect(draw).not.toBeNull();
    const d = draw as CardDraw;
    const secretEvidence = d.evidence.find((e) => e.detail.includes("****"));
    expect(secretEvidence, "expected a masked secret evidence item").toBeDefined();
    const detail = (secretEvidence as Evidence).detail;
    // Masked form keeps the first 4 chars then "****".
    expect(detail).toContain("AKIA****");
  });

  it("never retains the raw AWS key anywhere in the draw (R7.5)", () => {
    const draw = runDevil(files) as CardDraw;
    const serialized = JSON.stringify(draw);
    expect(serialized.includes(AWS_KEY)).toBe(false);
    for (const e of draw.evidence) {
      expect(AWS_KEY_RE.test(e.detail)).toBe(false);
    }
  });
});

describe("detectDevil: private-key header masking (R7.4, R7.5, R20.3)", () => {
  const files = {
    "src/keys.py":
      'PRIVATE_KEY = """-----BEGIN RSA PRIVATE KEY-----\nMIIExxxxFAKE\n-----END RSA PRIVATE KEY-----"""\n',
  };

  it("draws devil and masks the private-key header in evidence", () => {
    const draw = runDevil(files);
    expect(draw).not.toBeNull();
    const d = draw as CardDraw;
    assertNoRawSecrets(d.evidence);
    const masked = d.evidence.some((e) => e.detail.includes("****"));
    expect(masked, "expected the private-key evidence to be masked").toBe(true);
  });

  it("never leaves a raw private-key header in evidence (R20.3 safety net)", () => {
    const draw = runDevil(files) as CardDraw;
    assertNoRawSecrets(draw.evidence);
  });
});

// --- R7.6 OSV vulnerability evidence -------------------------------------

describe("detectDevil: injected osvData (R7.6)", () => {
  const osvData: OsvData = [
    {
      id: "CVE-2020-0001",
      severity: "HIGH",
      affectedPackage: "flask",
      affectedVersionRange: "<1.0",
    },
    {
      id: "GHSA-aaaa-bbbb-cccc",
      severity: "CRITICAL",
      affectedPackage: "django",
      affectedVersionRange: "<2.2",
    },
  ];

  it("adds one kind:\"osv\" evidence item per vulnerability", () => {
    const draw = runDevil({ "src/clean.py": "x = 1\n" }, osvData);
    expect(draw).not.toBeNull();
    const d = draw as CardDraw;
    const osvEvidence = d.evidence.filter((e) => e.kind === "osv");
    expect(osvEvidence.length).toBe(2);
    for (const e of osvEvidence) {
      expect(e.source).toBe("osv");
    }
  });

  it("includes the CVE/GHSA id and severity level in each osv detail", () => {
    const draw = runDevil({ "src/clean.py": "x = 1\n" }, osvData) as CardDraw;
    const osvEvidence = draw.evidence.filter((e) => e.kind === "osv");
    expect(
      osvEvidence.some(
        (e) => e.detail.includes("CVE-2020-0001") && e.detail.includes("HIGH"),
      ),
    ).toBe(true);
    expect(
      osvEvidence.some(
        (e) =>
          e.detail.includes("GHSA-aaaa-bbbb-cccc") &&
          e.detail.includes("CRITICAL"),
      ),
    ).toBe(true);
  });

  it("draws devil when only osv vulnerabilities are present (no code findings)", () => {
    const draw = runDevil({ "src/clean.py": "x = 1\n" }, osvData);
    expect(draw).not.toBeNull();
    expect((draw as CardDraw).card).toBe("devil");
  });
});

// --- R7.7 nothing found → null -------------------------------------------

describe("detectDevil: nothing found (R7.7)", () => {
  it("returns null for a clean file with no dangerous patterns, secrets, or osv", () => {
    const draw = runDevil({
      "src/clean.py": "def add(a, b):\n    return a + b\n",
    });
    expect(draw).toBeNull();
  });

  it("returns null when osvData is an empty array and code is clean", () => {
    const draw = runDevil({ "src/clean.py": "x = 1\n" }, []);
    expect(draw).toBeNull();
  });
});

// --- P8 (R20.2, R20.3) no raw secrets in any evidence --------------------

describe("detectDevil: no raw secrets in evidence (P8, R20.2, R20.3)", () => {
  it("emits no Evidence.detail matching AWS key or private-key patterns", () => {
    const draw = runDevil({
      "src/config.py":
        'AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE"\n' +
        'PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----"\n' +
        'api_key = "supersecretvalue"\n',
    });
    expect(draw).not.toBeNull();
    assertNoRawSecrets((draw as CardDraw).evidence);
  });
});
