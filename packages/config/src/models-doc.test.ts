// src/models-doc.test.ts
//
// Item 34 (judge-ready-pass): the models/env/openrouter operator doc exists and
// stays consistent with the env schema -- every env var the schema declares is
// documented in docs/MODELS.md, so the doc cannot silently drift from config.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { EnvSchema } from "./index.js";

const DOC = readFileSync(
  fileURLToPath(new URL("../../../docs/MODELS.md", import.meta.url)),
  "utf8",
);

describe("item 34: docs/MODELS.md documents the LLM/env configuration", () => {
  it("covers the core OpenRouter + model-tier + BYOK + smoke topics", () => {
    for (const topic of [
      "OPENROUTER_API_KEY",
      "NECRO_LLM_MODEL_FAST",
      "NECRO_LLM_MODEL_STRONG",
      "NECRO_TAROT_DAILY_CEILING",
      "Bring Your Own Key",
      "X-Necro-User-Key",
      "pnpm smoke:llm",
      "HTTP-Referer",
    ]) {
      expect(DOC.includes(topic), `MODELS.md is missing "${topic}"`).toBe(true);
    }
  });

  it("documents EVERY env var the schema declares (no silent drift)", () => {
    // The schema keys are the authoritative env surface.
    const keys = Object.keys((EnvSchema as unknown as { shape: Record<string, unknown> }).shape);
    expect(keys.length).toBeGreaterThan(5);
    const missing = keys.filter((k) => !DOC.includes(k));
    expect(missing, `env vars absent from docs/MODELS.md: ${missing.join(", ")}`).toEqual([]);
  });

  it("states that the default is offline/Mock and secrets are server-only", () => {
    expect(DOC.toLowerCase()).toContain("offline");
    expect(DOC.toLowerCase()).toContain("mock");
    expect(DOC).toMatch(/never (sent to the client|committ|logged)/i);
  });
});