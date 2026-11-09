// scripts/smoke-llm/smoke.ts
//
// Item 35 (judge-ready-pass): a `pnpm smoke:llm` smoke test for the LLM path
// that DOES NOT RUN LIVE by default.
//
// Purpose: give an operator a one-command check that the LLM plumbing (the
// LlmPort contract + the tarot reading service's parse/fallback) is wired, WITH
// A HARD GUARD against accidentally spending real tokens or hitting the network
// in CI. By default it runs entirely against the deterministic Mock provider
// (network-free). A live OpenRouter call happens ONLY when the operator sets
// BOTH an explicit opt-in flag AND a key -- so neither CI nor a careless `pnpm
// smoke:llm` ever reaches the wire.
//
//   pnpm smoke:llm                 -> Mock only, no network, exit 0
//   NECRO_SMOKE_LIVE=1 OPENROUTER_API_KEY=... NECRO_LLM_MODEL_FAST=... pnpm smoke:llm
//                                  -> ALSO performs ONE live FAST tarot call
//
// Run it with tsx:  tsx scripts/smoke-llm/smoke.ts
//
// It never prints the key. It performs at most ONE live call. It is NOT a unit
// test (vitest never imports it); it is an operator tool.

// Imported via relative source paths (like scripts/demo-bundle/generate.ts), so
// the root `tsx` run resolves them without the @necro/* specifiers needing a
// root-level node_modules link.
import { createMockLlmPort, createOpenRouterLlmPort } from "../../packages/llm/src/index.ts";
import {
  drawTarot,
  seededRandomFn,
  type TarotDraw,
} from "../../packages/oracle/src/index.ts";
import { generateTarotReading } from "../../packages/coven/src/index.ts";

/** The explicit live opt-in. Any value other than "1"/"true" stays offline. */
function liveOptIn(): boolean {
  const v = (process.env.NECRO_SMOKE_LIVE ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function line(s: string): void {
  process.stdout.write(s + "\n");
}

async function runMock(draw: TarotDraw): Promise<void> {
  line("[smoke:llm] MOCK path (no network, deterministic)...");
  const mock = createMockLlmPort();
  const result = await generateTarotReading({
    draw,
    llm: mock,
    model: "mock/model",
    cacheKey: "smoke-mock",
    // The Mock returns fixed text that will not match the 3-paragraph+VERDICT
    // shape, so the service falls back to the deterministic offline reading --
    // which is exactly the offline guarantee we want to smoke-test.
  });
  line(`[smoke:llm]   source=${result.source} paragraphs=${result.reading.paragraphs.length}`);
  if (result.reading.paragraphs.length !== 3) {
    throw new Error("mock reading did not yield three paragraphs");
  }
  line("[smoke:llm]   MOCK ok.");
}

async function runLive(draw: TarotDraw): Promise<void> {
  const key = process.env.OPENROUTER_API_KEY;
  const model = process.env.NECRO_LLM_MODEL_FAST;
  if (key === undefined || key === "" || model === undefined || model === "") {
    line(
      "[smoke:llm] LIVE opt-in set but OPENROUTER_API_KEY / NECRO_LLM_MODEL_FAST " +
        "missing; skipping the live call (staying offline). (key value withheld)",
    );
    return;
  }
  line(`[smoke:llm] LIVE path: ONE FAST call to model ${model} ...`);
  const provider = createOpenRouterLlmPort();
  const result = await generateTarotReading({
    draw,
    llm: provider,
    model,
    apiKey: key,
    byok: false,
    cacheKey: "smoke-live",
  });
  // On any failure the service falls back offline, so this never throws for a
  // transient upstream problem -- it reports the source instead.
  line(`[smoke:llm]   source=${result.source} (llm = a real completion parsed; fallback = upstream/parse issue)`);
  line("[smoke:llm]   LIVE ok (one call made).");
}

async function main(): Promise<void> {
  line("[smoke:llm] Necro-Oracle LLM smoke test. DOES NOT RUN LIVE unless");
  line("[smoke:llm] NECRO_SMOKE_LIVE=1 AND a key + FAST model are set.");
  const draw = drawTarot(seededRandomFn(20260104));

  await runMock(draw);

  if (liveOptIn()) {
    await runLive(draw);
  } else {
    line("[smoke:llm] LIVE path skipped (NECRO_SMOKE_LIVE not set). No network touched.");
  }

  line("[smoke:llm] DONE.");
}

main().catch((err: unknown) => {
  // Never print a key; print only the error message.
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[smoke:llm] FAILED: ${message}\n`);
  process.exitCode = 1;
});