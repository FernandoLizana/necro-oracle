// src/detectors/devil.ts
//
// XV — The Devil (Security Sins) detector.
//
// A pure, synchronous Detector that scans every Python file for dangerous call
// patterns and secret-like strings, folds in any injected OSV vulnerabilities,
// and draws The Devil when a security sin is present. All secret values are
// masked with `maskSecret` the instant they are captured — the raw value is
// never stored — and a final safety-net pass re-masks any Evidence.detail that
// still matches an AWS key or private-key header (R20.3).
//
// Detection (design.md "detectDevil — XV The Devil"):
//   1. Dangerous call patterns in each file's pre-parsed tree (opts.trees),
//      skipping files in opts.parseErrors; never calls parsePython.
//   2. Secret-like strings scanned from the file text content.
//   3. One kind:"osv" evidence per injected vulnerability.
//
// Orientation:
//   - any finding in production (non-test/example) code → severity 2, upright
//   - findings exclusively in test/example paths        → severity 1, reversed
//   - nothing found and no osv                          → null
//
// Covers: R7.1–R7.7, R20.2, R20.3

import { maskSecret } from "../util/mask.js";
import type { Evidence, CardDraw } from "../registry/schema.js";
import type { Detector, DetectorOpts } from "./types.js";
import type { RepoSnapshot } from "../snapshot/types.js";

// --- secret-detection patterns (mirrored in design.md) ------------------

const AWS_KEY_RE = /AKIA[0-9A-Z]{16}/g;
const PRIVATE_KEY_HEADER_RE = /-----BEGIN (?:RSA )?PRIVATE KEY-----/g;
/** Single-match forms used by the safety-net re-mask (R20.3). */
const AWS_KEY_ONE_RE = /AKIA[0-9A-Z]{16}/;
const PRIVATE_KEY_HEADER_ONE_RE = /-----BEGIN (?:RSA )?PRIVATE KEY-----/;

/** Identifier substrings that mark a value as a credential (case-insensitive). */
const SECRET_NAME_RE =
  /(secret|password|passwd|credential|token|api_?key)/i;

/** Weak-hash call near a credential-named symbol. */
const WEAK_HASH_NAME_RE =
  /(password|passwd|credential|secret|token|api_?key)/i;

// --- test/example path classification -----------------------------------

/**
 * True when a path is a test or example path: a `tests/` or `examples/`
 * segment anywhere, a `conftest.py` basename, or a `test_*.py` / `*_test.py`
 * filename.
 */
function isTestOrExamplePath(path: string): boolean {
  const segments = path.split("/");
  const base = segments[segments.length - 1] ?? "";
  if (segments.includes("tests") || segments.includes("examples")) return true;
  if (base === "conftest.py") return true;
  if (/^test_.*\.py$/.test(base)) return true;
  if (/^.*_test\.py$/.test(base)) return true;
  return false;
}

// --- dangerous-pattern scanning ------------------------------------------

interface Finding {
  kind: string;
  detail: string;
  line?: number;
}

/** 1-based line number of a 0-based character offset within source text. */
function lineAt(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i++) {
    if (source.charCodeAt(i) === 10 /* \n */) line++;
  }
  return line;
}

/**
 * Scan a single Python source for dangerous call patterns. Text-based matching
 * is used for the call forms (eval(, exec(, os.system(, pickle.loads(, etc.),
 * which lets us distinguish `exec(` (a call) from py2 `exec_statement`
 * (`exec code` with no parenthesis) without false positives. The matcher skips
 * attribute/qualified forms so `self.eval(` or `obj.exec(` do not count.
 */
function scanDangerousPatterns(source: string): Finding[] {
  const findings: Finding[] = [];

  const addCall = (re: RegExp, kind: string, detail: string): void => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      findings.push({ kind, detail, line: lineAt(source, m.index) });
    }
  };

  // eval( — bare call, not a .eval( attribute access.
  addCall(/(?<![\w.])eval\s*\(/g, "dangerous-eval", "eval() executes arbitrary code");
  // exec( — bare function call (py3). py2 `exec code` has no paren → not matched.
  addCall(/(?<![\w.])exec\s*\(/g, "dangerous-exec", "exec() executes arbitrary code");
  // pickle.loads( — insecure deserialization.
  addCall(/pickle\s*\.\s*loads\s*\(/g, "dangerous-pickle", "pickle.loads() deserializes untrusted data");
  // os.system( — shell command injection surface.
  addCall(/os\s*\.\s*system\s*\(/g, "dangerous-os-system", "os.system() runs a shell command");

  // yaml.load( WITHOUT a Loader= keyword argument.
  {
    const re = /yaml\s*\.\s*load\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      const args = readCallArgs(source, m.index + m[0].length - 1);
      if (args !== null && !/\bLoader\s*=/.test(args)) {
        findings.push({
          kind: "dangerous-yaml-load",
          detail: "yaml.load() without a Loader= is unsafe",
          line: lineAt(source, m.index),
        });
      }
    }
  }

  // subprocess call with shell=True keyword argument.
  {
    const re = /subprocess\s*\.\s*\w+\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      const args = readCallArgs(source, m.index + m[0].length - 1);
      if (args !== null && /\bshell\s*=\s*True\b/.test(args)) {
        findings.push({
          kind: "dangerous-shell-true",
          detail: "subprocess call with shell=True enables shell injection",
          line: lineAt(source, m.index),
        });
      }
    }
  }

  // requests / urllib call with verify=False.
  {
    const re = /(?:requests|urllib(?:\d|\.\w+)*)\s*\.\s*\w+\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      const args = readCallArgs(source, m.index + m[0].length - 1);
      if (args !== null && /\bverify\s*=\s*False\b/.test(args)) {
        findings.push({
          kind: "dangerous-verify-false",
          detail: "TLS verification disabled with verify=False",
          line: lineAt(source, m.index),
        });
      }
    }
  }

  // md5/sha1 used near a credential-named symbol.
  {
    const re = /\b(?:hashlib\s*\.\s*)?(md5|sha1)\s*\(/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      const lineStart = source.lastIndexOf("\n", m.index) + 1;
      let lineEnd = source.indexOf("\n", m.index);
      if (lineEnd === -1) lineEnd = source.length;
      const lineText = source.slice(lineStart, lineEnd);
      // Look at the whole line (assignment target, call arg, enclosing name).
      if (WEAK_HASH_NAME_RE.test(lineText)) {
        const algo = (m[1] ?? "md5").toLowerCase();
        findings.push({
          kind: "weak-hash",
          detail: `${algo} used for a credential-named value`,
          line: lineAt(source, m.index),
        });
      }
    }
  }

  return findings;
}

/**
 * Given the index of an opening "(" in source, return the text between it and
 * the matching ")", or null if unbalanced. Honors nesting and skips string
 * literals so parentheses/keywords inside strings are not misread.
 */
function readCallArgs(source: string, openParenIndex: number): string | null {
  let depth = 0;
  let quote: string | null = null;
  const start = openParenIndex + 1;
  for (let i = openParenIndex; i < source.length; i++) {
    const ch = source[i];
    if (quote !== null) {
      if (ch === "\\") {
        i++; // skip escaped char
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return source.slice(start, i);
    }
  }
  return null;
}

// --- secret scanning -----------------------------------------------------

/**
 * Scan source text for secret-like strings. Every raw secret value is masked
 * with maskSecret BEFORE it is placed into a Finding detail (R20.2) — the raw
 * value never leaves this function.
 */
function scanSecrets(source: string): Finding[] {
  const findings: Finding[] = [];

  // AWS access key IDs.
  AWS_KEY_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = AWS_KEY_RE.exec(source)) !== null) {
    findings.push({
      kind: "secret-aws-key",
      detail: `AWS access key ID: ${maskSecret(m[0])}`,
      line: lineAt(source, m.index),
    });
  }

  // Private-key headers.
  PRIVATE_KEY_HEADER_RE.lastIndex = 0;
  while ((m = PRIVATE_KEY_HEADER_RE.exec(source)) !== null) {
    findings.push({
      kind: "secret-private-key",
      detail: `Private key material detected: ${maskSecret(m[0])}`,
      line: lineAt(source, m.index),
    });
  }

  // High-entropy assignment: credential-named identifier = quoted string >= 8.
  const assignRe =
    /([A-Za-z_]\w*)\s*=\s*(?:"([^"\n]*)"|'([^'\n]*)')/g;
  while ((m = assignRe.exec(source)) !== null) {
    const identifier = m[1] ?? "";
    const value = m[2] ?? m[3] ?? "";
    if (SECRET_NAME_RE.test(identifier) && value.length >= 8) {
      findings.push({
        kind: "secret-assignment",
        detail: `credential-named value ${identifier} = ${maskSecret(value)}`,
        line: lineAt(source, m.index),
      });
    }
  }

  return findings;
}

// --- the detector --------------------------------------------------------

export const detectDevil: Detector = (
  snapshot: RepoSnapshot,
  opts: DetectorOpts,
): CardDraw | null => {
  const prodEvidence: Evidence[] = [];
  const testEvidence: Evidence[] = [];

  for (const file of snapshot.files) {
    if (file.lang !== "python") continue;
    // Only scan files we successfully pre-parsed (R7.1 reads opts.trees).
    if (opts.parseErrors.has(file.path)) continue;
    if (!opts.trees.has(file.path)) continue;

    const source = snapshot.contents.get(file.path) ?? "";
    const findings: Finding[] = [
      ...scanDangerousPatterns(source),
      ...scanSecrets(source),
    ];
    if (findings.length === 0) continue;

    const bucket = isTestOrExamplePath(file.path) ? testEvidence : prodEvidence;
    for (const f of findings) {
      bucket.push({
        kind: f.kind,
        path: file.path,
        ...(f.line !== undefined ? { line: f.line } : {}),
        detail: f.detail,
        source: "static",
      });
    }
  }

  // OSV vulnerabilities (injected). One evidence item each (R7.6).
  const osvEvidence: Evidence[] = [];
  for (const vuln of opts.osvData ?? []) {
    osvEvidence.push({
      kind: "osv",
      detail: `${vuln.id} (${vuln.severity}) affects ${vuln.affectedPackage} ${vuln.affectedVersionRange}`,
      source: "osv",
    });
  }

  const hasProd = prodEvidence.length > 0;
  const hasTest = testEvidence.length > 0;
  const hasOsv = osvEvidence.length > 0;

  // Nothing found and no OSV → the card is not drawn (R7.7).
  if (!hasProd && !hasTest && !hasOsv) return null;

  // Orientation: any production/OSV finding → severity 2 upright; findings
  // exclusively in test/example paths → severity 1 reversed (R7.2, R7.3).
  const upright = hasProd || hasOsv;
  const severity = upright ? 2 : 1;
  const orientation = upright ? "upright" : "reversed";

  const evidence: Evidence[] = [...prodEvidence, ...testEvidence, ...osvEvidence];

  // SAFETY NET (R20.3): re-mask any detail that still carries a raw AWS key or
  // private-key header, so no raw secret can survive into the draw.
  for (const e of evidence) {
    if (AWS_KEY_ONE_RE.test(e.detail) || PRIVATE_KEY_HEADER_ONE_RE.test(e.detail)) {
      e.detail = e.detail
        .replace(AWS_KEY_RE, (match) => maskSecret(match))
        .replace(PRIVATE_KEY_HEADER_RE, (match) => maskSecret(match));
    }
  }

  const summary = upright
    ? `Security sins found in ${prodEvidence.length + osvEvidence.length} place(s); The Devil binds this code.`
    : "Security sins confined to tests and examples; The Devil lies reversed.";

  return {
    card: "devil",
    severity,
    orientation,
    evidence,
    summary,
    grimoires: [],
  };
};
