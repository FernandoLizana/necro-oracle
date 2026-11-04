// Example tests for the reading, summary, help, explain, demo-label and error
// renderers (task 9.1, TEST-FIRST).
//
// TEST-FIRST (red). These examples are written before the renderer modules
// (`render/{reading,summary,help,explain,demo-label,errors}.ts`, task 9.2), so
// every SUT import below fails to resolve and the suite is red for the expected
// reason: those modules do not exist yet.
//
// Validates: Requirements R4.1-R4.4, R5.4-R5.8, R6.10, R7.2, R7.6, R7.7, R7.9,
// R7.10, R8.2-R8.6, R11.1-R11.3, R11.8, R18.5, R18.11, and Q7.
//
// These are concrete examples that pin layout, copy and the gates the
// properties cannot express as cheaply (void positions, the vitality gauge
// shape, the live-vs-demo evidence-link gate, the degraded/cache/truncated
// summary lines, the help content and its no-network guarantee, and the
// closing error-count block of Q7).

import { describe, expect, it } from "vitest";

import type {
  CardDraw,
  Evidence,
  Reading,
  RepoRef,
  SpreadPosition,
} from "@necro/oracle/client";
import { getCard } from "@necro/oracle/client";

import type { ReadingResponse, SummonSummary } from "../protocol.js";
import { DEMO_LABEL, VOICE_TABLE } from "../index.js";
import type { Segment } from "../text/wrap.js";
import type { BlockDraft, OutputLine } from "./blocks.js";
import { blockText, lineText } from "./blocks.js";
// Not yet implemented — task 9.2 adds these modules.
import { withDemoLabel } from "./demo-label.js";
import { renderError } from "./errors.js";
import { renderExplain } from "./explain.js";
import { renderHelp } from "./help.js";
import { renderReading } from "./reading.js";
import { renderSummary } from "./summary.js";

// --- Fixtures ----------------------------------------------------------------

const REF: RepoRef = {
  owner: "octocat",
  name: "legacy-app",
  sha: "0123456789abcdef0123456789abcdef01234567",
  defaultBranch: "master",
};

const TOWER_EVIDENCE: Evidence[] = [
  {
    kind: "dependency_stale",
    path: "requirements.txt",
    line: 14,
    detail: "MySQL-python is 3 major versions behind",
    source: "registry",
  },
  {
    kind: "dependency_stale",
    path: "requirements.txt",
    line: 15,
    detail: "six is pinned to a Python-2-only release",
    source: "static",
  },
];

function drawnPosition(
  position: number,
  overrides: Partial<CardDraw> & Pick<CardDraw, "card">,
): SpreadPosition {
  const draw: CardDraw = {
    card: overrides.card,
    severity: overrides.severity ?? 2,
    orientation: overrides.orientation ?? "upright",
    evidence: overrides.evidence ?? [],
    summary: overrides.summary ?? "Short deterministic technical fact.",
    grimoires: overrides.grimoires ?? [],
  };
  return { position, label: `POSITION ${position}`, draw };
}

function voidPosition(position: number, description: string): SpreadPosition {
  return { position, label: `POSITION ${position}`, draw: null, description };
}

function makeReading(
  spread: readonly SpreadPosition[],
  overrides: Partial<Reading> = {},
): Reading {
  const draws = spread
    .filter((p): p is SpreadPosition & { draw: CardDraw } => p.draw !== null)
    .map((p) => p.draw);
  return {
    id: "00000000-0000-4000-8000-000000000000",
    repo: REF,
    draws,
    spread: [...spread],
    vitality: overrides.vitality ?? 42,
    createdAt: "2025-01-01T00:00:00.000Z",
    engineVersion: "1.0.0",
    errors: overrides.errors ?? [],
    ...overrides,
  };
}

const BASE_SUMMARY: SummonSummary = {
  ref: REF,
  stars: 128,
  hasWorkflowsDir: true,
  degradedFields: [],
  cache: "miss",
  fileCount: 237,
  truncated: false,
};

function makeResponse(
  spread: readonly SpreadPosition[],
  overrides: { reading?: Partial<Reading>; summary?: Partial<SummonSummary> } = {},
): ReadingResponse {
  return {
    summary: { ...BASE_SUMMARY, ...overrides.summary },
    reading: makeReading(spread, overrides.reading ?? {}),
  };
}

// --- renderSummary (R5.4-R5.8) ----------------------------------------------

describe("renderSummary", () => {
  it("shows the star and file counts (R5.5, R5.6)", () => {
    const text = blockText(renderSummary({ ...BASE_SUMMARY, stars: 128, fileCount: 237 }));
    expect(text).toContain("128");
    expect(text).toContain("237");
  });

  it("marks a cache hit distinctly from a miss (R5.7)", () => {
    const hit = blockText(renderSummary({ ...BASE_SUMMARY, cache: "hit" }));
    const miss = blockText(renderSummary({ ...BASE_SUMMARY, cache: "miss" }));
    expect(hit).not.toBe(miss);
    expect(hit.toUpperCase()).toContain("HIT");
  });

  it("notes a truncated snapshot (R5.8)", () => {
    const truncated = blockText(renderSummary({ ...BASE_SUMMARY, truncated: true }));
    const whole = blockText(renderSummary({ ...BASE_SUMMARY, truncated: false }));
    expect(truncated).not.toBe(whole);
    expect(truncated.toUpperCase()).toContain("TRUNCATED");
  });

  it("names the degraded fields when present (R5.4)", () => {
    const degraded = blockText(
      renderSummary({ ...BASE_SUMMARY, degradedFields: ["pulls", "release"] }),
    );
    expect(degraded.toLowerCase()).toContain("pulls");
    expect(degraded.toLowerCase()).toContain("release");
  });

  it("shows the owner/name/sha of the pinned ref", () => {
    const text = blockText(renderSummary(BASE_SUMMARY));
    expect(text).toContain("octocat");
    expect(text).toContain("legacy-app");
    expect(text).toContain(REF.sha);
  });
});

// --- renderHelp (R4.1-R4.4) --------------------------------------------------

describe("renderHelp", () => {
  it("lists the core commands (R4.1, R4.2)", () => {
    const text = blockText(renderHelp()).toLowerCase();
    for (const name of ["summon", "read", "explain", "help", "clear", "demo", "motion", "sound"]) {
      expect(text).toContain(name);
    }
  });

  it("is a pure function of nothing — identical output every call, no network (R4.3, R4.4)", () => {
    // renderHelp takes no arguments and reads no port: two calls are equal, and
    // the only way to produce it is from static copy (no fetch/clock/DOM here).
    const a = blockText(renderHelp());
    const b = blockText(renderHelp());
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });
});

// --- renderReading: vitality gauge, void, severity 0, closing block ----------

describe("renderReading", () => {
  it("renders the 20-cell vitality gauge with the exact fill (R7.7)", () => {
    const resp = makeResponse([drawnPosition(1, { card: "tower" })], {
      reading: { vitality: 42 },
    });
    const text = blockText(renderReading(resp).at(-1)!);
    // VITALITY 42/100 with a 20-cell [#...-] gauge. 42% of 20 = 8.4 -> 8 filled.
    expect(text).toContain("VITALITY 42/100");
    const gauge = /\[([#-]{20})\]/.exec(text);
    expect(gauge).not.toBeNull();
    const cells = gauge![1]!;
    expect(cells).toHaveLength(20);
    expect([...cells].filter((c) => c === "#")).toHaveLength(8);
    expect([...cells].filter((c) => c === "-")).toHaveLength(12);
  });

  it("fills the gauge fully at 100 and not at all at 0", () => {
    const full = blockText(
      renderReading(
        makeResponse([drawnPosition(1, { card: "tower" })], { reading: { vitality: 100 } }),
      ).at(-1)!,
    );
    expect(full).toContain(`[${"#".repeat(20)}]`);

    const empty = blockText(
      renderReading(
        makeResponse([drawnPosition(1, { card: "tower" })], { reading: { vitality: 0 } }),
      ).at(-1)!,
    );
    expect(empty).toContain(`[${"-".repeat(20)}]`);
  });

  it("closes with the vitality voice line and the explain hint", () => {
    const text = blockText(
      renderReading(
        makeResponse([drawnPosition(1, { card: "tower" })], { reading: { vitality: 42 } }),
      ).at(-1)!,
    );
    expect(text.toLowerCase()).toContain("explain");
  });

  it("renders a void position with VOID and its description (R6.10)", () => {
    const resp = makeResponse([voidPosition(1, "No card fell in this seat.")]);
    const blocks = renderReading(resp);
    const voidText = blockText(blocks[0]!);
    expect(voidText.toUpperCase()).toContain("VOID");
    expect(voidText).toContain("No card fell in this seat.");
  });

  it("renders SEVERITY 0 exactly as received for a latent card (R7.2)", () => {
    const resp = makeResponse([
      drawnPosition(1, { card: "star", severity: 0, orientation: "reversed" }),
    ]);
    const text = blockText(renderReading(resp)[0]!);
    expect(text).toContain("SEVERITY 0");
  });

  it("uppercases card names and uses no emoji (R7.9, R7.10)", () => {
    const resp = makeResponse([drawnPosition(1, { card: "tower" })]);
    const text = blockText(renderReading(resp)[0]!);
    const expectedName = getCard("tower").name.toUpperCase();
    expect(text).toContain(expectedName);
    // No emoji / pictographic symbols anywhere in the block.
    expect(/\p{Extended_Pictographic}/u.test(text)).toBe(false);
  });

  it("prints the VOICE_TABLE mystical line for the drawn orientation", () => {
    const resp = makeResponse([
      drawnPosition(1, { card: "tower", orientation: "upright" }),
    ]);
    const text = blockText(renderReading(resp)[0]!);
    expect(text).toContain(VOICE_TABLE.tower.upright);
  });

  it("adds a closing block naming the failed-detector count when errors are present (Q7)", () => {
    const withErrors = makeResponse([drawnPosition(1, { card: "tower" })], {
      reading: {
        errors: [
          { code: "DETECTOR_FAILED", userMessage: "The Devil detector choked." },
          { code: "DETECTOR_FAILED", userMessage: "The Moon detector choked." },
        ],
      },
    });
    const withoutErrors = makeResponse([drawnPosition(1, { card: "tower" })], {
      reading: { errors: [] },
    });

    const blocksWith = renderReading(withErrors);
    const blocksWithout = renderReading(withoutErrors);
    // The error case has exactly one extra (closing) block.
    expect(blocksWith.length).toBe(blocksWithout.length + 1);

    const closing = blockText(blocksWith.at(-1)!);
    expect(closing).toContain("2");
    expect(closing.toUpperCase()).toContain("DETECTOR_FAILED");
    // It adds no card: no extra card name leaks into the closing block.
    for (const cardId of ["tower", "devil", "moon"] as const) {
      // only the drawn card (tower) could legitimately appear elsewhere; the
      // closing error block names codes, not card headings.
      if (cardId !== "tower") {
        expect(closing).not.toContain(getCard(cardId).name.toUpperCase());
      }
    }
  });
});

// --- live-vs-demo evidence link gate (R7.6, R18.11) -------------------------

describe("evidence link gate (live vs demo)", () => {
  const spread = [drawnPosition(1, { card: "tower", evidence: TOWER_EVIDENCE })];

  it("renders clickable evidence links for a live reading (R7.6)", () => {
    const liveResp = makeResponse(spread); // demo flag absent => live
    const block: BlockDraft = renderReading(liveResp)[0]!;
    const hrefs = block.lines.flatMap((l: OutputLine) =>
      l.segments
        .filter((s: Segment) => s.href !== undefined)
        .map((s: Segment) => s.href!),
    );
    expect(hrefs.length).toBeGreaterThanOrEqual(1);
    expect(hrefs[0]!.startsWith(`https://github.com/${REF.owner}/${REF.name}/blob/${REF.sha}/`)).toBe(true);
  });

  it("renders demo evidence as fixture text with no link (R18.11)", () => {
    const demoResp = makeResponse(spread, { summary: { demo: true } });
    const block: BlockDraft = renderReading(demoResp)[0]!;
    const hrefs = block.lines.flatMap((l: OutputLine) =>
      l.segments.filter((s: Segment) => s.href !== undefined),
    );
    expect(hrefs).toHaveLength(0);
    const text = blockText(block);
    expect(text).toContain("fixture:requirements.txt");
  });
});

// --- renderExplain (R8.2-R8.6) ----------------------------------------------

describe("renderExplain", () => {
  const spread = [
    drawnPosition(1, { card: "tower", evidence: TOWER_EVIDENCE }),
    voidPosition(2, "Nothing stirs in the second seat."),
  ];
  const resp = makeResponse(spread);

  it("explains a card by position index, showing every evidence field (R8.2, R8.3)", () => {
    const text = renderExplain(resp, { kind: "position", position: 1 })
      .map(blockText)
      .join("\n");
    for (const item of TOWER_EVIDENCE) {
      expect(text).toContain(item.kind);
      expect(text).toContain(item.source);
      expect(text).toContain(item.path!);
      expect(text).toContain(String(item.line));
      expect(text).toContain(item.detail);
    }
  });

  it("explains a card by its card id (R8.4)", () => {
    const text = renderExplain(resp, { kind: "card", card: "tower" })
      .map(blockText)
      .join("\n");
    expect(text).toContain(getCard("tower").name.toUpperCase());
    expect(text).toContain(TOWER_EVIDENCE[0]!.detail);
  });

  it("explains an out-of-range position with an error, not a crash (R8.5)", () => {
    const text = renderExplain(resp, { kind: "position", position: 99 })
      .map(blockText)
      .join("\n")
      .toLowerCase();
    // A graceful message, not an exception.
    expect(text.length).toBeGreaterThan(0);
    expect(text).toMatch(/no card|not.*position|out of|void|unknown/);
  });

  it("explains a card not present in the reading with a graceful message (R8.6)", () => {
    const text = renderExplain(resp, { kind: "card", card: "world" })
      .map(blockText)
      .join("\n")
      .toLowerCase();
    expect(text.length).toBeGreaterThan(0);
    expect(text).toMatch(/not.*drawn|no .*world|not present|did not fall/);
  });

  it("explains a void position as void with its description (R8.5)", () => {
    const text = renderExplain(resp, { kind: "position", position: 2 })
      .map(blockText)
      .join("\n");
    expect(text.toUpperCase()).toContain("VOID");
    expect(text).toContain("Nothing stirs in the second seat.");
  });
});

// --- renderError (R11.1, R11.2, R11.3, R11.8) -------------------------------

describe("renderError", () => {
  it("puts ERROR <CODE> on the first line and splits userMessage at the first newline (R11.1, R11.2)", () => {
    const block = renderError({
      code: "RATE_LIMITED",
      userMessage: "The gate is barred.\nRate limit reached; try again shortly.",
    });
    expect(lineText(block.lines[0]!)).toContain("ERROR RATE_LIMITED");
    const body = block.lines.slice(1).map(lineText) as string[];
    expect(body.some((l: string) => l.includes("The gate is barred."))).toBe(true);
    expect(body.some((l: string) => l.includes("Rate limit reached; try again shortly."))).toBe(true);
  });

  it("supplies a generic mystical line when userMessage has no newline (R11.3)", () => {
    const block = renderError({
      code: "NETWORK_TIMEOUT",
      userMessage: "A single technical line.",
    });
    const body = (block.lines.slice(1).map(lineText) as string[]).filter(
      (l: string) => l.trim() !== "",
    );
    // mystical line + the technical message = at least two non-empty body lines.
    expect(body.length).toBeGreaterThanOrEqual(2);
    expect(body.some((l: string) => l.includes("A single technical line."))).toBe(true);
  });

  it("renders the error block with the error kind (R11.8)", () => {
    const block = renderError({ code: "REPO_NOT_FOUND", userMessage: "Gone.\nMissing." });
    expect(block.kind).toBe("error");
  });
});

// --- withDemoLabel (R18.5) ---------------------------------------------------

describe("withDemoLabel", () => {
  it("prepends the DEMO_LABEL line and marks every block as demo (R18.5)", () => {
    const resp = makeResponse([drawnPosition(1, { card: "tower" })]);
    const original = renderReading(resp);
    const labelled = withDemoLabel(original);

    // One extra block at the front carrying the DEMO_LABEL.
    expect(labelled.length).toBe(original.length + 1);
    expect(blockText(labelled[0]!)).toContain(DEMO_LABEL);

    // Every returned block is marked demo: true.
    for (const block of labelled) {
      expect(block.demo).toBe(true);
    }
  });

  it("does not mutate the input blocks", () => {
    const resp = makeResponse([drawnPosition(1, { card: "tower" })]);
    const original: BlockDraft[] = renderReading(resp);
    const beforeDemoFlags = original.map((b: BlockDraft) => b.demo);
    withDemoLabel(original);
    expect(original.map((b: BlockDraft) => b.demo)).toEqual(beforeDemoFlags);
  });
});
