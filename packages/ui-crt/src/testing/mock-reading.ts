// Deterministic (non-fast-check) builders for the component/hook tests.
//
// Feature: 03-crt-terminal, task 17.1 (TEST-FIRST, red phase).
//
// The property suites use the fast-check arbitraries in `./arbitraries.ts`.
// The component tests instead want a single, fixed, schema-valid
// `ReadingResponse`/`SummonSummary`/`DemoBundle` they can render and assert
// against by exact text. These builders produce those concrete values, parsed
// through the real `@necro/oracle/client` schemas so any drift in the oracle
// shape breaks here, not deep inside a component test.

import {
  CardDrawSchema,
  ReadingSchema,
  RepoRefSchema,
  SpreadPositionSchema,
  type CardDraw,
  type CardId,
  type Reading,
  type RepoRef,
  type SpreadPosition,
} from "@necro/oracle/client";

import type {
  DemoBundle,
  PlayableSpread,
  ReadingResponse,
  SummonSummary,
} from "../protocol.js";

/** A fixed, valid 40-hex sha used across the component tests. */
export const MOCK_SHA = "0".repeat(39) + "1";

/** A fixed, valid `RepoRef` for the live-reading tests. */
export function mockRef(
  overrides: Partial<RepoRef> = {},
): RepoRef {
  return RepoRefSchema.parse({
    owner: "spooky",
    name: "crypt",
    sha: MOCK_SHA,
    defaultBranch: "main",
    ...overrides,
  });
}

/** A `SummonSummary`. Pass `demo: true` for a demo-replay summary (R18.5). */
export function mockSummary(
  overrides: Partial<SummonSummary> = {},
): SummonSummary {
  const base: SummonSummary = {
    ref: mockRef(),
    stars: 42,
    hasWorkflowsDir: true,
    degradedFields: [],
    cache: "miss",
    fileCount: 128,
    truncated: false,
  };
  return { ...base, ...overrides };
}

/** A drawn card carrying one path-bearing evidence item (for the link test). */
function mockDraw(
  card: CardId,
  position: number,
): CardDraw {
  return CardDrawSchema.parse({
    card,
    severity: 2,
    orientation: "upright",
    evidence: [
      {
        kind: "static",
        detail: `detail-${position}`,
        source: "static",
        path: `src/module_${position}.py`,
        line: 10 + position,
      },
    ],
    summary: `summary-${position}`,
    grimoires: [],
  });
}

/** A two-position fates spread: both positions drawn with evidence. */
function mockSpread(): SpreadPosition[] {
  const cards: CardId[] = ["judgement", "tower"];
  return cards.map((card, index) =>
    SpreadPositionSchema.parse({
      position: index + 1,
      label: `POSITION ${index + 1}`,
      draw: mockDraw(card, index + 1),
    }),
  );
}

/** A fixed, schema-valid `Reading` with two drawn cards and no errors. */
export function mockReading(ref: RepoRef = mockRef()): Reading {
  const spread = mockSpread();
  const draws = spread
    .filter((p): p is SpreadPosition & { draw: CardDraw } => p.draw !== null)
    .map((p) => p.draw);
  return ReadingSchema.parse({
    repo: ref,
    spread,
    draws,
    vitality: 40,
    createdAt: "2026-01-01T00:00:00.000Z",
    id: "00000000-0000-4000-8000-000000000000",
    engineVersion: "1.0.0",
    errors: [],
  });
}

/** A live `ReadingResponse` (evidence links allowed). */
export function mockReadingResponse(
  options: { readonly demo?: boolean } = {},
): ReadingResponse {
  const ref = mockRef();
  const summary = options.demo
    ? mockSummary({ ref, demo: true })
    : mockSummary({ ref });
  return { summary, reading: mockReading(ref) };
}

/** A one-entry `DemoBundle` keyed by the demo name, with fates + necropsy. */
export function mockDemoBundle(name = "lich-py2"): DemoBundle {
  const fates = mockReadingResponse({ demo: true });
  const necropsy = mockReadingResponse({ demo: true });
  return { [name]: { fates, necropsy } };
}

/** The two spreads the terminal can play, for parameterised tests. */
export const PLAYABLE_SPREADS: readonly PlayableSpread[] = ["fates", "necropsy"];
