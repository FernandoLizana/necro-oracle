// scripts/demo-bundle/generate.ts
//
// Feature: 03-crt-terminal, task 29.2 — the Demo_Bundle generator script.
//
// Drives `buildDemoBundle` over `fixtures/graveyard/` and writes the result as
// STABLE JSON (keys sorted, 2-space indent, trailing newline) to
// `apps/web/src/demo/bundle.generated.json`. The stable serialisation makes the
// generated file byte-reproducible so re-running the generator produces no diff
// unless a fixture or the oracle actually changed.
//
// PREREQUISITE: the oracle must be built first, because `build-demo.ts` imports
// the compiled `@necro/oracle` and `@necro/oracle/node` entries:
//
//     pnpm --filter @necro/oracle build
//     pnpm demo:bundle            # tsx scripts/demo-bundle/generate.ts
//
// Everything runs offline against the on-disk fixtures: no network, LLM, or
// sandbox call is made.
//
// _Requirements: R18.3, R18.12, R18.13_

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildDemoBundle } from "../../apps/web/src/demo/build-demo.ts";

/** The repo root, resolved from this script's location (scripts/demo-bundle/). */
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** The authored graveyard fixtures the generator reads. */
const FIXTURES_ROOT = join(REPO_ROOT, "fixtures", "graveyard");

/** The generated bundle the loader lazily imports. */
const OUTPUT_PATH = join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "demo",
  "bundle.generated.json",
);

/**
 * Recursively sort object keys so the serialised JSON is deterministic. Arrays
 * keep their order (card/spread order is meaningful); only object keys sort.
 */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

async function main(): Promise<void> {
  const bundle = await buildDemoBundle(FIXTURES_ROOT);
  const stable = JSON.stringify(sortKeysDeep(bundle), null, 2) + "\n";

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, stable, "utf8");

  // eslint-disable-next-line no-console
  console.log(`Wrote demo bundle → ${OUTPUT_PATH}`);
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
