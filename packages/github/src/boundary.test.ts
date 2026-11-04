// Package boundary scan (task 30.1). Requirements: R10.1–R10.7.
// Scans source text only; nothing under test is executed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GITHUB_SRC = HERE;
const ORACLE_SRC = path.resolve(HERE, "../../oracle/src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

const isTest = (f: string) => /\.(test|pbt\.test|spike\.test|e2e)\.ts$/.test(f);
const rel = (root: string, f: string) => path.relative(root, f).split(path.sep).join("/");

/** Remove block and line comments (good enough for import/identifier scans). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

/** All module specifiers: static from, side-effect import, dynamic import, require, export-from. */
function specifiers(src: string): string[] {
  const code = stripComments(src);
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["']([^"']+)["']/g;
  const out: string[] = [];
  for (let m = re.exec(code); m; m = re.exec(code)) out.push(m[1] as string);
  return out;
}

const githubSources = walk(GITHUB_SRC).filter((f) => !isTest(f));
const oracleSources = walk(ORACLE_SRC).filter((f) => !isTest(f));

describe("package boundaries (R10.1–R10.7)", () => {
  it("scans a non-trivial set of files", () => {
    expect(githubSources.length).toBeGreaterThan(5);
    expect(oracleSources.length).toBeGreaterThan(5);
  });

  it("packages/oracle contains no @necro/github import", () => {
    const bad = oracleSources.filter((f) =>
      specifiers(fs.readFileSync(f, "utf8")).some((s) => s === "@necro/github" || s.startsWith("@necro/github/")),
    );
    expect(bad.map((f) => rel(ORACLE_SRC, f))).toEqual([]);
  });

  it("packages/github imports @necro/oracle only via its package entry", () => {
    const bad: string[] = [];
    for (const f of githubSources) {
      for (const s of specifiers(fs.readFileSync(f, "utf8"))) {
        if (s.startsWith("@necro/oracle") && s !== "@necro/oracle") bad.push(`${rel(GITHUB_SRC, f)}: ${s}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("packages/github imports no other @necro/* package (including @necro/config)", () => {
    const bad: string[] = [];
    for (const f of githubSources) {
      for (const s of specifiers(fs.readFileSync(f, "utf8"))) {
        if (s.startsWith("@necro/") && s !== "@necro/oracle") bad.push(`${rel(GITHUB_SRC, f)}: ${s}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("packages/github has no process.env outside adapters/", () => {
    const bad = githubSources
      .filter((f) => !rel(GITHUB_SRC, f).startsWith("adapters/"))
      .filter((f) => /\bprocess\s*\.\s*env\b|\bprocess\s*\[\s*["']env["']\s*\]/.test(stripComments(fs.readFileSync(f, "utf8"))));
    expect(bad.map((f) => rel(GITHUB_SRC, f))).toEqual([]);
  });

  it("packages/github uses no global fetch outside adapters/", () => {
    const re = /(?<![\w.$])fetch\s*\(|\b(?:globalThis|window|self|global)\s*\.\s*fetch\b/;
    const bad = githubSources
      .filter((f) => !rel(GITHUB_SRC, f).startsWith("adapters/"))
      .filter((f) => re.test(stripComments(fs.readFileSync(f, "utf8"))));
    expect(bad.map((f) => rel(GITHUB_SRC, f))).toEqual([]);
  });
});
