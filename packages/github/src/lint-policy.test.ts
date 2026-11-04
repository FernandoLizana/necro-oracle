// Lint-policy test for packages/github/src (task 5.1; enforcement lands in 5.2).
// Lints snippets with the real root eslint.config.js through the ESLint Node API.
// Requirements: R9.1, R9.2, R9.3, R3.2, R6.1.
//
// The type-aware rules in eslint.config.js resolve files through tsconfig's
// `projectService`, which requires the linted path to exist on disk and be
// covered by a tsconfig `include`. So each snippet is written to a real
// throwaway file under packages/github/src before linting, then removed.
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import { ESLint } from "eslint";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SRC = path.join(ROOT, "packages", "github", "src");

/** Rules the policy block is expected to use. Only these count as "reported". */
const POLICY_RULES = new Set([
  "no-restricted-globals",
  "no-restricted-syntax",
  "no-restricted-imports",
]);

let eslint: ESLint;
const writtenFiles = new Set<string>();

beforeAll(() => {
  eslint = new ESLint({ cwd: ROOT });
});

afterEach(async () => {
  await Promise.all(
    Array.from(writtenFiles).map((f) => fs.rm(f, { force: true })),
  );
  writtenFiles.clear();
});

async function lint(code: string, filePath: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, code, "utf8");
  writtenFiles.add(filePath);
  const [result] = await eslint.lintFiles([filePath]);
  if (!result) throw new Error("ESLint returned no result");
  return result.messages;
}

/** Policy messages only; also fails loudly on parse errors so a broken setup cannot pass. */
async function policyHits(code: string, filePath: string) {
  const messages = await lint(code, filePath);
  const fatal = messages.filter((m) => m.fatal);
  expect(fatal, `fatal lint error: ${fatal.map((m) => m.message).join("; ")}`).toEqual([]);
  return messages.filter((m) => m.ruleId !== null && POLICY_RULES.has(m.ruleId));
}

const BANNED: Array<[string, string]> = [
  ["Date.now()", "export const t = Date.now();\n"],
  ["zero-argument new Date()", "export const d = new Date();\n"],
  ["bare Date()", "export const s = Date();\n"],
  ["global fetch(...)", 'export const r = fetch("https://example.test");\n'],
  ["process.env.X", "export const x = process.env.X;\n"],
  ["eval", 'export const v = eval("1");\n'],
  ["new Function", 'export const f = new Function("return 1");\n'],
  ["import node:fs", 'import { readFileSync } from "node:fs";\nexport const r = readFileSync;\n'],
  [
    "import node:child_process",
    'import { exec } from "node:child_process";\nexport const e = exec;\n',
  ],
  ["import node:vm", 'import { runInNewContext } from "node:vm";\nexport const r = runInNewContext;\n'],
];

const ALLOWED: Array<[string, string]> = [
  ["new Date(ms).toISOString()", "export const iso = (ms: number) => new Date(ms).toISOString();\n"],
  [
    'import { Readable } from "node:stream"',
    'import { Readable } from "node:stream";\nexport const r = Readable;\n',
  ],
];

describe("lint policy: packages/github/src (R9.1, R9.2, R9.3, R3.2, R6.1)", () => {
  const logicFile = path.join(SRC, "policy-probe.ts");

  describe("banned constructs are reported in package logic", () => {
    it.each(BANNED)("%s", async (_name, code) => {
      const hits = await policyHits(code, logicFile);
      expect(hits.length).toBeGreaterThan(0);
    });
  });

  describe("permitted constructs are not reported in package logic", () => {
    it.each(ALLOWED)("%s", async (_name, code) => {
      expect(await policyHits(code, logicFile)).toEqual([]);
    });
  });

  describe("exempt locations are not reported", () => {
    const exempt: Array<[string, string]> = [
      ["src/adapters/", path.join(SRC, "adapters", "probe.ts")],
      ["src/testing/", path.join(SRC, "testing", "probe.ts")],
      ["*.test.ts", path.join(SRC, "probe.test.ts")],
      ["*.pbt.test.ts", path.join(SRC, "probe.pbt.test.ts")],
    ];
    for (const [label, file] of exempt) {
      describe(label, () => {
        it.each(BANNED)("%s", async (_name, code) => {
          expect(await policyHits(code, file)).toEqual([]);
        });
      });
    }
  });
});
