// @necro/oracle — unit tests for manifest parsing (task 12.1).
//
// TEST-FIRST: these tests are written against the manifest API described in
// design.md and requirements R4 (parseAllManifests / detectPythonVersion,
// ParsedDependency / Manifest / PythonVersionSignal) BEFORE the real
// implementation exists (task 12.2). They are EXPECTED TO BE RED until 12.2
// replaces the throwing stubs in manifest.ts with real parsing logic.
//
// Snapshots are built with the browser-safe buildSnapshotFromFileMap (task 8.2)
// so no filesystem access is needed. The tree-sitter WASM grammar is
// initialised once in vitest.setup.ts's beforeAll (task 10), which setup.py AST
// extraction (R4.2) relies on — no network access (R3.1, R21.5, R21.6).
//
// Coverage map:
//   R4.1 requirements*.txt → ParsedDependency[] (name/versionSpec/extras)
//   R4.2 setup.py parsed via AST only, never executed
//   R4.3 pyproject.toml [project] AND [tool.poetry]
//   R4.4 Pipfile (TOML)
//   R4.5 package.json
//   R4.6 invalid content → { parsed:false, parseError, dependencies:[] }
//   R4.7 detectPythonVersion priority + "unknown" fallback
//   R4.8 parseAllManifests identifies all manifest files
import { describe, expect, it } from "vitest";

import { buildSnapshotFromFileMap } from "../snapshot/builder-file-map.js";
import type { RepoRef, RepoSnapshot } from "../snapshot/types.js";

import {
  detectPythonVersion,
  parseAllManifests,
  type Manifest,
  type ManifestKind,
} from "./manifest.js";

// --- test helpers --------------------------------------------------------

const REF: RepoRef = {
  owner: "necro",
  name: "graveyard",
  sha: "deadbeef",
  defaultBranch: "main",
};

const CREATED_AT = "2025-01-01T00:00:00.000Z";

/** Build a snapshot from a path→content map (no fs, no clock). */
function snapshotOf(files: Record<string, string>): RepoSnapshot {
  return buildSnapshotFromFileMap(REF, files, { createdAt: CREATED_AT });
}

/** parseAllManifests on a one-file-map snapshot. */
function manifestsOf(files: Record<string, string>): Manifest[] {
  return parseAllManifests(snapshotOf(files));
}

/** The single manifest parsed from `path` in a one-manifest snapshot. */
function singleManifest(path: string, content: string): Manifest {
  const manifests = manifestsOf({ [path]: content });
  const found = manifests.find((m) => m.path === path);
  expect(found, `expected a manifest for ${path}`).toBeDefined();
  return found as Manifest;
}

/** Find a dependency by name in a manifest. */
function depNamed(manifest: Manifest, name: string): {
  name: string;
  versionSpec: string;
  extras: string[];
} {
  const dep = manifest.dependencies.find((d) => d.name === name);
  expect(dep, `expected dependency "${name}" in ${manifest.path}`).toBeDefined();
  return dep as { name: string; versionSpec: string; extras: string[] };
}

// --- R4.1 requirements*.txt ---------------------------------------------

describe("parseAllManifests: requirements*.txt (R4.1)", () => {
  it("classifies requirements.txt as the requirements_txt kind", () => {
    const m = singleManifest("requirements.txt", "requests>=2.0\n");
    expect(m.kind satisfies ManifestKind).toBe("requirements_txt");
    expect(m.parsed).toBe(true);
  });

  it("parses name, versionSpec, and extras from a specifier line", () => {
    const m = singleManifest(
      "requirements.txt",
      "requests[security]>=2.0\n",
    );
    const dep = depNamed(m, "requests");
    expect(dep.versionSpec).toBe(">=2.0");
    expect(dep.extras).toEqual(["security"]);
  });

  it("parses multiple extras and preserves the raw version specifier", () => {
    const m = singleManifest(
      "requirements.txt",
      "celery[redis,auth]==4.4.7\n",
    );
    const dep = depNamed(m, "celery");
    expect(dep.versionSpec).toBe("==4.4.7");
    expect(dep.extras).toEqual(["redis", "auth"]);
  });

  it("yields empty versionSpec and empty extras for a bare, unpinned dependency", () => {
    const m = singleManifest("requirements.txt", "flask\n");
    const dep = depNamed(m, "flask");
    expect(dep.versionSpec).toBe("");
    expect(dep.extras).toEqual([]);
  });

  it("ignores blank lines and comments", () => {
    const m = singleManifest(
      "requirements.txt",
      "# core deps\n\nrequests>=2.0\n\n  # trailing comment\n",
    );
    expect(m.dependencies.map((d) => d.name)).toEqual(["requests"]);
  });

  it("matches requirements*.txt at any depth (e.g. requirements-dev.txt in a subdir)", () => {
    const manifests = manifestsOf({
      "deps/requirements-dev.txt": "pytest>=6.0\n",
    });
    const m = manifests.find((x) => x.path === "deps/requirements-dev.txt");
    expect(m).toBeDefined();
    expect(m?.kind).toBe("requirements_txt");
    expect(m?.dependencies.map((d) => d.name)).toContain("pytest");
  });
});

// --- R4.2 setup.py (AST, never executed) --------------------------------

describe("parseAllManifests: setup.py via AST (R4.2)", () => {
  const SETUP_PY = [
    "from setuptools import setup",
    "",
    "setup(",
    "    name='legacy-pkg',",
    "    install_requires=['requests>=2.0', 'six'],",
    "    python_requires='>=2.7',",
    "    classifiers=[",
    "        'Programming Language :: Python :: 2',",
    "        'Programming Language :: Python :: 2.7',",
    "    ],",
    ")",
    "",
  ].join("\n");

  it("classifies setup.py as the setup_py kind and parses it", () => {
    const m = singleManifest("setup.py", SETUP_PY);
    expect(m.kind).toBe("setup_py");
    expect(m.parsed).toBe(true);
  });

  it("extracts the static name literal", () => {
    const m = singleManifest("setup.py", SETUP_PY);
    expect(m.raw?.name).toBe("legacy-pkg");
  });

  it("extracts install_requires into ParsedDependency entries", () => {
    const m = singleManifest("setup.py", SETUP_PY);
    const names = m.dependencies.map((d) => d.name).sort();
    expect(names).toEqual(["requests", "six"]);
    expect(depNamed(m, "requests").versionSpec).toBe(">=2.0");
  });

  it("extracts python_requires and classifiers as static literals", () => {
    const m = singleManifest("setup.py", SETUP_PY);
    expect(m.raw?.python_requires).toBe(">=2.7");
    expect(m.raw?.classifiers).toEqual([
      "Programming Language :: Python :: 2",
      "Programming Language :: Python :: 2.7",
    ]);
  });

  it("omits dynamic (non-literal) fields rather than throwing or executing them", () => {
    // install_requires is computed, not a static list literal: it must be
    // omitted. The file must NOT be executed — read_reqs() never runs.
    const dynamic = [
      "from setuptools import setup",
      "def read_reqs():",
      "    raise RuntimeError('this must never execute')",
      "",
      "setup(",
      "    name='dyn-pkg',",
      "    install_requires=read_reqs(),",
      "    version=__import__('os').getcwd(),",
      ")",
      "",
    ].join("\n");
    const m = singleManifest("setup.py", dynamic);
    expect(m.parsed).toBe(true);
    // Static name is still extracted.
    expect(m.raw?.name).toBe("dyn-pkg");
    // Dynamic install_requires is omitted → no dependencies derived from it.
    expect(m.dependencies).toEqual([]);
    // Dynamic field omitted entirely (not present with a bogus value).
    expect(m.raw?.install_requires).toBeUndefined();
  });
});

// --- R4.3 pyproject.toml ([project] + [tool.poetry]) --------------------

describe("parseAllManifests: pyproject.toml (R4.3)", () => {
  it("extracts [project] name, version, requires-python, and dependencies", () => {
    const pyproject = [
      "[project]",
      'name = "modern-pkg"',
      'version = "1.2.3"',
      'requires-python = ">=3.9"',
      'dependencies = ["requests>=2.28", "rich"]',
      "",
    ].join("\n");
    const m = singleManifest("pyproject.toml", pyproject);
    expect(m.kind).toBe("pyproject_toml");
    expect(m.parsed).toBe(true);
    expect(m.raw?.name).toBe("modern-pkg");
    expect(m.raw?.version).toBe("1.2.3");
    expect(m.raw?.["requires-python"]).toBe(">=3.9");
    const names = m.dependencies.map((d) => d.name).sort();
    expect(names).toEqual(["requests", "rich"]);
    expect(depNamed(m, "requests").versionSpec).toBe(">=2.28");
  });

  it("extracts [tool.poetry] name, version, python, and package dependencies", () => {
    const pyproject = [
      "[tool.poetry]",
      'name = "poetry-pkg"',
      'version = "0.9.0"',
      'packages = [{ include = "poetry_pkg" }]',
      "",
      "[tool.poetry.dependencies]",
      'python = "^3.8"',
      'requests = "^2.28"',
      "",
    ].join("\n");
    const m = singleManifest("pyproject.toml", pyproject);
    expect(m.kind).toBe("pyproject_toml");
    expect(m.parsed).toBe(true);
    expect(m.raw?.name).toBe("poetry-pkg");
    expect(m.raw?.version).toBe("0.9.0");
    // Poetry declares the Python constraint under [tool.poetry.dependencies].
    expect(m.raw?.python).toBe("^3.8");
    // `python` is the interpreter constraint, not a runtime dependency.
    expect(m.dependencies.map((d) => d.name)).not.toContain("python");
    expect(m.dependencies.map((d) => d.name)).toContain("requests");
  });
});

// --- R4.4 Pipfile (TOML) -------------------------------------------------

describe("parseAllManifests: Pipfile (R4.4)", () => {
  it("extracts [packages], [dev-packages], and [requires] python_version", () => {
    const pipfile = [
      "[[source]]",
      'url = "https://pypi.org/simple"',
      "",
      "[packages]",
      'requests = "*"',
      'flask = ">=1.0"',
      "",
      "[dev-packages]",
      'pytest = "*"',
      "",
      "[requires]",
      'python_version = "2.7"',
      "",
    ].join("\n");
    const m = singleManifest("Pipfile", pipfile);
    expect(m.kind).toBe("pipfile");
    expect(m.parsed).toBe(true);
    const names = m.dependencies.map((d) => d.name).sort();
    expect(names).toEqual(["flask", "pytest", "requests"]);
    expect(m.raw?.python_version).toBe("2.7");
  });
});

// --- R4.5 package.json ---------------------------------------------------

describe("parseAllManifests: package.json (R4.5)", () => {
  it("extracts dependencies, devDependencies, engines, and scripts", () => {
    const pkg = JSON.stringify(
      {
        name: "web-app",
        version: "1.0.0",
        dependencies: { react: "^18.2.0", "lodash.merge": "4.6.2" },
        devDependencies: { vitest: "^1.0.0" },
        engines: { node: ">=22" },
        scripts: { test: "vitest run", build: "tsc" },
      },
      null,
      2,
    );
    const m = singleManifest("package.json", pkg);
    expect(m.kind).toBe("package_json");
    expect(m.parsed).toBe(true);
    const names = m.dependencies.map((d) => d.name).sort();
    expect(names).toEqual(["lodash.merge", "react", "vitest"]);
    expect(depNamed(m, "react").versionSpec).toBe("^18.2.0");
    expect(m.raw?.engines).toEqual({ node: ">=22" });
    expect(m.raw?.scripts).toEqual({ test: "vitest run", build: "tsc" });
  });
});

// --- R4.6 invalid content → parsed:false --------------------------------

describe("parseAllManifests: invalid content (R4.6)", () => {
  it("returns parsed:false with a parseError and empty dependencies for malformed JSON (does not throw)", () => {
    const manifests = manifestsOf({ "package.json": "{ not valid json, }" });
    const m = manifests.find((x) => x.path === "package.json");
    expect(m).toBeDefined();
    expect(m?.parsed).toBe(false);
    expect(typeof m?.parseError).toBe("string");
    expect(m?.parseError?.length ?? 0).toBeGreaterThan(0);
    expect(m?.dependencies).toEqual([]);
  });

  it("returns parsed:false with a parseError for malformed TOML (does not throw)", () => {
    const manifests = manifestsOf({
      "pyproject.toml": "[project\nname = broken = =",
    });
    const m = manifests.find((x) => x.path === "pyproject.toml");
    expect(m).toBeDefined();
    expect(m?.parsed).toBe(false);
    expect(typeof m?.parseError).toBe("string");
    expect(m?.dependencies).toEqual([]);
  });

  it("does not throw when any manifest is invalid", () => {
    expect(() =>
      manifestsOf({ "Pipfile": "[packages\nrequests = =" }),
    ).not.toThrow();
  });
});

// --- R4.8 parseAllManifests identifies all manifest files ---------------

describe("parseAllManifests: identifies every manifest in a snapshot (R4.8)", () => {
  it("parses one Manifest per recognised manifest file across the snapshot", () => {
    const manifests = manifestsOf({
      "requirements.txt": "requests>=2.0\n",
      "setup.py": "from setuptools import setup\nsetup(name='p')\n",
      "pyproject.toml": '[project]\nname = "p"\n',
      "Pipfile": '[packages]\nflask = "*"\n',
      "package.json": '{ "name": "p", "dependencies": {} }',
      "src/app.py": "print('hi')\n",
      "README.md": "# hi\n",
    });
    const byKind = new Map<ManifestKind, number>();
    for (const m of manifests) {
      byKind.set(m.kind, (byKind.get(m.kind) ?? 0) + 1);
    }
    expect(byKind.get("requirements_txt")).toBe(1);
    expect(byKind.get("setup_py")).toBe(1);
    expect(byKind.get("pyproject_toml")).toBe(1);
    expect(byKind.get("pipfile")).toBe(1);
    expect(byKind.get("package_json")).toBe(1);
    // Non-manifest files are not treated as manifests.
    expect(manifests.length).toBe(5);
  });

  it("returns an empty array when the snapshot has no manifest files", () => {
    const manifests = manifestsOf({
      "src/app.py": "print('hi')\n",
      "README.md": "# hi\n",
    });
    expect(manifests).toEqual([]);
  });
});

// --- R4.7 detectPythonVersion -------------------------------------------

describe("detectPythonVersion: priority and fallback (R4.7)", () => {
  it("returns 'unknown' when no manifest carries a structured signal", () => {
    const manifests = manifestsOf({
      "requirements.txt": "requests>=2.0\n",
    });
    expect(detectPythonVersion(manifests)).toBe("unknown");
  });

  it("returns 'unknown' for an empty manifest list", () => {
    expect(detectPythonVersion([])).toBe("unknown");
  });

  it("reports py2_only from setup.py classifiers restricted to Python 2", () => {
    const setupPy = [
      "from setuptools import setup",
      "setup(",
      "    name='legacy',",
      "    classifiers=[",
      "        'Programming Language :: Python :: 2',",
      "        'Programming Language :: Python :: 2.7',",
      "    ],",
      ")",
      "",
    ].join("\n");
    expect(detectPythonVersion(manifestsOf({ "setup.py": setupPy }))).toBe(
      "py2_only",
    );
  });

  it("reports py3_only from setup.py classifiers restricted to Python 3", () => {
    const setupPy = [
      "from setuptools import setup",
      "setup(",
      "    name='modern',",
      "    classifiers=[",
      "        'Programming Language :: Python :: 3',",
      "        'Programming Language :: Python :: 3.11',",
      "    ],",
      ")",
      "",
    ].join("\n");
    expect(detectPythonVersion(manifestsOf({ "setup.py": setupPy }))).toBe(
      "py3_only",
    );
  });

  it("reports straddling when classifiers list both Python 2 and Python 3", () => {
    const setupPy = [
      "from setuptools import setup",
      "setup(",
      "    name='both',",
      "    classifiers=[",
      "        'Programming Language :: Python :: 2.7',",
      "        'Programming Language :: Python :: 3.8',",
      "    ],",
      ")",
      "",
    ].join("\n");
    expect(detectPythonVersion(manifestsOf({ "setup.py": setupPy }))).toBe(
      "straddling",
    );
  });

  it("falls back to pyproject requires-python when setup.py has no classifier signal", () => {
    const setupPy =
      "from setuptools import setup\nsetup(name='p')\n";
    const pyproject = '[project]\nname = "p"\nrequires-python = ">=3.9"\n';
    const manifests = manifestsOf({
      "setup.py": setupPy,
      "pyproject.toml": pyproject,
    });
    expect(detectPythonVersion(manifests)).toBe("py3_only");
  });

  it("prioritises setup.py classifiers over pyproject requires-python when both are present", () => {
    const setupPy = [
      "from setuptools import setup",
      "setup(",
      "    name='p',",
      "    classifiers=['Programming Language :: Python :: 2.7'],",
      ")",
      "",
    ].join("\n");
    // pyproject disagrees (py3), but setup.py classifiers win.
    const pyproject = '[project]\nname = "p"\nrequires-python = ">=3.9"\n';
    const manifests = manifestsOf({
      "setup.py": setupPy,
      "pyproject.toml": pyproject,
    });
    expect(detectPythonVersion(manifests)).toBe("py2_only");
  });

  it("falls back to Pipfile python_version when neither setup.py nor pyproject carry a signal", () => {
    const manifests = manifestsOf({
      "Pipfile": '[requires]\npython_version = "2.7"\n',
    });
    expect(detectPythonVersion(manifests)).toBe("py2_only");
  });

  it("prioritises pyproject requires-python over Pipfile python_version", () => {
    const pyproject = '[project]\nname = "p"\nrequires-python = ">=3.10"\n';
    const pipfile = '[requires]\npython_version = "2.7"\n';
    const manifests = manifestsOf({
      "pyproject.toml": pyproject,
      "Pipfile": pipfile,
    });
    expect(detectPythonVersion(manifests)).toBe("py3_only");
  });
});
