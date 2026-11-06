// packages/coven/src/mask.pbt.test.ts
//
// Property 12 (design: "Error Handling", "Redaction"; R12.3, R13.2):
//
//   No secret survives into any output. For content carrying secret-like
//   values routed through ANY sink (the per-file diff, the unified Patch, a
//   Stream_Line, the LLM prompt, a ledger entry, an error), no RAW secret
//   value survives; every occurrence has been reduced to the fixed
//   `maskSecret` fingerprint.
//
// Two layers are exercised, both over fast-check (`numRuns: 200`, seed printed
// on failure — vitest/fast-check print the failing seed automatically):
//
//   1. The PRIMITIVE every sink routes through. `maskSecretsInText` is the one
//      function the runner calls before a string reaches the diff, Patch,
//      Stream_Line, ledger, or LLM prompt (see runners/local.ts). We generate
//      content embedding secret-like values (AWS access-key ids, PEM private-
//      key headers, credential-named assignments) interleaved with ordinary
//      text and assert that after masking (a) no raw secret value survives and
//      (b) each secret's `maskSecret` fingerprint IS present. Because the mask
//      token is the oracle fingerprint `<first 4>****`, "no raw secret
//      survives" means the WHOLE secret value no longer appears — the 4-char
//      fingerprint prefix is the intended, non-recoverable residue, so secrets
//      are generated long enough that the fingerprint is a strict, identifiable
//      shortening of the raw value.
//
//   2. The runner END-TO-END. A candidate `.py` file whose content embeds a
//      secret is driven through a REAL `LocalCovenRunner` (stub grimoire in a
//      registry, fake ports, real snapshot — the harness mirrors tasks
//      11.2/11.3). We then assert the raw secret appears in NONE of the sinks
//      the Ritual produces: every `FileResult.before`/`after`, every rendered
//      `DiffLine`, the unified `patch`, every streamed Phase/Skip-note, and
//      every ledger entry.
//
// Testing steering: no network, no LLM, no sandbox. The runner resolves its
// grimoire from an injected registry (a STUB — the real
// `@necro/grimoires-py2to3` is deliberately NOT imported, honouring
// oracle <- grimoires <- coven), reads time ONLY through an injected ClockPort,
// and re-diagnosis runs a REAL local `runReading` over the overlay (a local
// parse the steering permits). The oracle `maskSecret` fingerprint is imported
// so the test and the implementation agree on the exact mask token.
//
// **Validates: Requirements 12.3, 13.2**

import {
  buildSnapshotFromFileMap,
  initParser,
  maskSecret,
  type CardDraw,
  type Evidence,
  type Reading,
  type RepoMeta,
  type RepoRef,
  type RepoSnapshot,
} from "@necro/oracle";
import { z } from "zod";
import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";

import { maskSecretsInText } from "./mask.js";
import { LocalCovenRunner, type PhaseEmit } from "./runners/local.js";
import { LanguagePairRegistry } from "./registry.js";
import type {
  ClockPort,
  Grimoire,
  LedgerPort,
  RitualPorts,
} from "./ports.js";
import {
  LanguagePairIdSchema,
  type LedgerEvent,
  type RitualInput,
} from "./models.js";

/** P12 runs the default property budget (200). */
const NUM_RUNS = 200;

// ---------------------------------------------------------------------------
// Secret-like value generators. Each arbitrary yields `{ raw, text }` where
// `raw` is the exact secret substring that must NOT survive masking and `text`
// is a snippet embedding `raw`. The three kinds mirror the detection patterns
// in mask.ts (and the oracle Devil detector): AWS access-key ids, PEM private-
// key headers, and credential-named quoted assignments.
// ---------------------------------------------------------------------------

interface Secret {
  /** The exact raw secret substring (what must never survive). */
  readonly raw: string;
  /** The identifying mask token the fingerprint reduces `raw` to. */
  readonly masked: string;
}

/** `AKIA` + 16 upper-alphanumeric chars (an AWS access-key id). */
const arbAwsKey: fc.Arbitrary<Secret> = fc
  .stringOf(
    fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("")),
    { minLength: 16, maxLength: 16 },
  )
  .map((tail) => {
    const raw = `AKIA${tail}`;
    return { raw, masked: maskSecret(raw) };
  });

/** A PEM private-key header line (RSA or PKCS#8). */
const arbPemHeader: fc.Arbitrary<Secret> = fc
  .boolean()
  .map((rsa) => {
    const raw = rsa
      ? "-----BEGIN RSA PRIVATE KEY-----"
      : "-----BEGIN PRIVATE KEY-----";
    return { raw, masked: maskSecret(raw) };
  });

/**
 * A credential-named assignment `ident = "value"`. Only the quoted VALUE is the
 * secret the masker reduces (the identifier and quotes are preserved), so `raw`
 * is the value alone. The value is >= 8 non-quote, non-newline chars so the
 * assignment pattern matches, and the identifier contains a credential word so
 * the name gate (`SECRET_NAME_RE`) fires.
 */
const arbAssignment: fc.Arbitrary<{ secret: Secret; snippet: string }> = fc
  .record({
    name: fc.constantFrom("password", "api_key", "SECRET", "token", "credential"),
    quote: fc.constantFrom('"', "'"),
    // No quote chars, no newline, no backslash; length >= 8.
    value: fc.stringOf(
      fc.constantFrom(
        ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-./".split(
          "",
        ),
      ),
      { minLength: 8, maxLength: 40 },
    ),
  })
  .map(({ name, quote, value }) => ({
    secret: { raw: value, masked: maskSecret(value) },
    snippet: `${name} = ${quote}${value}${quote}`,
  }));

/** Ordinary, secret-free text to interleave around the secrets. */
const arbOrdinary: fc.Arbitrary<string> = fc.constantFrom(
  "import os\n",
  "def main():\n",
  "    return 0\n",
  "# a comment\n",
  "x = 1 + 2\n",
  "value = 'short'\n", // < 8 chars value: not secret-like, must pass through
  "name = 'alice'\n",
  "\n",
  "print('ok')\n",
);

/**
 * A full content string interleaving ordinary lines with one or more secret-
 * bearing snippets, plus the list of raw secrets it embeds and each secret's
 * identifying fingerprint. The assignment snippet carries its own `ident = "v"`
 * wrapping; the AWS / PEM secrets are placed on their own lines.
 */
const arbSecretContent: fc.Arbitrary<{
  text: string;
  secrets: readonly Secret[];
}> = fc
  .array(
    fc.oneof(
      arbAwsKey.map((s) => ({ snippet: `k = ${s.raw}\n`, secret: s })),
      arbPemHeader.map((s) => ({ snippet: `${s.raw}\n`, secret: s })),
      arbAssignment.map(({ secret, snippet }) => ({
        snippet: `${snippet}\n`,
        secret,
      })),
    ),
    { minLength: 1, maxLength: 6 },
  )
  .chain((secretParts) =>
    fc
      .array(arbOrdinary, {
        minLength: secretParts.length,
        maxLength: secretParts.length + 4,
      })
      .map((ordinary) => {
        // Interleave: ordinary, secret, ordinary, secret, ... so secrets are
        // surrounded by non-secret text (not merely concatenated).
        const chunks: string[] = [];
        for (let i = 0; i < secretParts.length; i++) {
          chunks.push(ordinary[i] ?? "");
          chunks.push(secretParts[i]!.snippet);
        }
        for (let i = secretParts.length; i < ordinary.length; i++) {
          chunks.push(ordinary[i]!);
        }
        return {
          text: chunks.join(""),
          secrets: secretParts.map((p) => p.secret),
        };
      }),
  );

// ---------------------------------------------------------------------------
// Layer 1 — the primitive every sink routes through (`maskSecretsInText`).
// ---------------------------------------------------------------------------

describe("P12 (R12.3, R13.2): no secret survives maskSecretsInText", () => {
  it("masks every secret-like value; no raw secret survives, each fingerprint present", () => {
    fc.assert(
      fc.property(arbSecretContent, ({ text, secrets }) => {
        const masked = maskSecretsInText(text);
        for (const secret of secrets) {
          // The WHOLE raw secret value is gone from the output.
          expect(masked.includes(secret.raw)).toBe(false);
          // Every occurrence became the fixed `maskSecret` fingerprint.
          expect(masked.includes(secret.masked)).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("is idempotent — masking the masked output changes nothing further", () => {
    fc.assert(
      fc.property(arbSecretContent, ({ text }) => {
        const once = maskSecretsInText(text);
        const twice = maskSecretsInText(once);
        expect(twice).toBe(once);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("leaves secret-free text byte-for-byte unchanged", () => {
    fc.assert(
      fc.property(
        fc.array(arbOrdinary, { minLength: 0, maxLength: 8 }).map((xs) => xs.join("")),
        (plain) => {
          expect(maskSecretsInText(plain)).toBe(plain);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Layer 2 — the runner END-TO-END. A candidate file embedding a secret is
// driven through a real LocalCovenRunner; the raw secret must appear in NONE of
// the Ritual's sinks (every FileResult before/after, every DiffLine, the Patch,
// every Stream_Line, every ledger entry).
// ---------------------------------------------------------------------------

const REF: RepoRef = {
  owner: "graveyard",
  name: "dead-repo",
  sha: "0".repeat(40),
  defaultBranch: "main",
};

const META: RepoMeta = {
  pushedAt: null,
  isArchived: false,
  openIssueCount: 0,
  openPRCount: 0,
  oldestOpenPRAgeDays: null,
  latestReleaseAt: null,
  licenseKey: null,
};

const NOW = "2024-01-01T00:00:00.000Z";
const PAIR_ID = LanguagePairIdSchema.parse("python2->python3");

/** A py2-classified static evidence item on a `.py` path (what SELECT reads). */
function py2Evidence(path: string): Evidence {
  return {
    kind: "print_statement",
    path,
    line: 1,
    detail: "legacy print statement",
    source: "static",
  };
}

/** A minimal Judgement draw flagging `path` as py2. */
function judgementDraw(path: string): CardDraw {
  return {
    card: "judgement" as CardDraw["card"],
    severity: 2,
    orientation: "reversed",
    evidence: [py2Evidence(path)],
    summary: "legacy python 2 constructs",
    grimoires: [],
  };
}

function reading(draws: CardDraw[]): Reading {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    repo: REF,
    draws,
    spread: [],
    vitality: 50,
    createdAt: NOW,
    engineVersion: "0.0.0",
    errors: [],
  };
}

function snapshotOf(files: Record<string, string>): RepoSnapshot {
  return buildSnapshotFromFileMap(REF, files, { meta: META, createdAt: NOW });
}

/** A RitualInput over one py2 file flagged by `judgement`, bare target. */
function ritualInput(content: string): RitualInput {
  return {
    pairId: PAIR_ID,
    snapshot: snapshotOf({ "legacy.py": content }),
    reading: reading([judgementDraw("legacy.py")]),
    target: { kind: "bare" },
    spread: "necropsy",
    now: NOW,
    demo: false,
  };
}

/** A frozen-time ClockPort — budgets never trip. */
function makeClock(): ClockPort {
  return { nowMs: () => 1_000_000 };
}

/** A capturing, append-only LedgerPort. */
function makeLedger(): LedgerPort & { events: LedgerEvent[] } {
  const events: LedgerEvent[] = [];
  return {
    async append(event: LedgerEvent): Promise<void> {
      events.push(event);
    },
    events,
  };
}

/** A PhaseEmit capturing phases and skip-notes. */
function makeEmit(): PhaseEmit & { phases: string[]; skipNotes: string[] } {
  const phases: string[] = [];
  const skipNotes: string[] = [];
  return {
    phase(phase): void {
      phases.push(phase);
    },
    skipNote(note): void {
      skipNotes.push(note);
    },
    phases,
    skipNotes,
  };
}

/**
 * An adapter-free STUB Grimoire. Its PRE_PASS fixer is a PASS-THROUGH (the
 * runner has already masked the candidate content at SELECT, so a pass-through
 * `after` carries whatever masked text the before held); `validate` reports
 * valid Python 3 so the file is kept in the Patch; the LLM step is never driven
 * in Degraded_Mode. The real grimoire is NOT imported (oracle <- grimoires <-
 * coven).
 */
function stubGrimoire(): Grimoire {
  const outputSchema = z.object({ converted: z.boolean() });
  return {
    id: "stub",
    pair: { from: "python2", to: "python3" } as unknown as Grimoire["pair"],
    inputSchema: z.object({
      path: z.string(),
      before: z.string(),
    }) as unknown as Grimoire["inputSchema"],
    outputSchema: z.object({
      path: z.string(),
      before: z.string(),
      after: z.string(),
      diff: z.array(z.unknown()),
      residuals: z.array(z.unknown()),
      fullyConverted: z.boolean(),
      validated: z.boolean(),
    }) as unknown as Grimoire["outputSchema"],
    // Pass-through fixer: changes a benign token so a diff exists, WITHOUT ever
    // reintroducing a secret (it only rewrites the `print` keyword to `print(`,
    // leaving secret lines untouched). Using a trivial mechanical edit keeps
    // some add/remove DiffLines in the output to exercise the diff/patch sinks.
    fixers: [
      (source) => ({
        after: source.replace(/print "([^"\n]*)"/g, 'print("$1")'),
        residuals: [],
      }),
    ],
    llm: {
      outputSchema: outputSchema as unknown as Grimoire["llm"]["outputSchema"],
      buildRequest: () => ({
        system: "convert",
        prompt: "data",
        maxTokens: 16,
        timeoutMs: 1_000,
        cacheKey: "k",
      }),
      apply: (source) => source,
      mockFixture: () => '{"converted":true}',
    },
    validate: (_after: string) => ({ valid: true, errorNodeCount: 0 }),
    divergenceAllowlist: [],
  };
}

function registryWith(): LanguagePairRegistry {
  const registry = new LanguagePairRegistry();
  registry.register(PAIR_ID, stubGrimoire());
  return registry;
}

/**
 * Drive the runner over a candidate file whose content embeds `secretContent`
 * and collect every string sink it produced. Degraded_Mode (no LlmPort) is used
 * so no LLM is touched; the sandbox is absent; budgets are frozen.
 */
async function runAndCollectSinks(content: string): Promise<{
  sinks: string[];
}> {
  const runner = new LocalCovenRunner(registryWith());
  const emit = makeEmit();
  const ledger = makeLedger();
  const ports: RitualPorts = {
    clock: makeClock(),
    ledger,
    // llm absent => Degraded_Mode, no LLM touched
  };

  const outcome = await runner.run(ritualInput(content), ports, emit);

  const sinks: string[] = [];
  // Terminal error message (there should be none here, but include it anyway).
  if (outcome.error !== null) sinks.push(outcome.error.userMessage);
  // Patch sink.
  sinks.push(outcome.result.patch);
  // Per-file before/after + rendered diff lines.
  for (const file of outcome.result.files) {
    sinks.push(file.before, file.after);
    for (const d of file.diff) sinks.push(d.text);
    for (const r of file.residuals) {
      sinks.push(r.path, r.construct, r.reason);
    }
  }
  // Stream_Lines: phases + skip-notes.
  sinks.push(...emit.phases, ...emit.skipNotes);
  // Ledger entries.
  for (const e of ledger.events) sinks.push(e.type, String(e.seq), e.at);

  return { sinks };
}

// The runner arms the oracle parser and REDIAGNOSE runs a real local reading.
beforeAll(async () => {
  await initParser();
});

describe("P12 (R12.3, R13.2): no secret survives any runner sink", () => {
  it("routes a secret-bearing candidate through the runner; raw secret appears in no sink", async () => {
    await fc.assert(
      fc.asyncProperty(arbSecretContent, async ({ text, secrets }) => {
        // Ensure the file still looks like a py2 candidate so SELECT admits it
        // (the stub fixer rewrites `print "..."`), and embed the secret content.
        const content = `print "hello"\n${text}`;
        const { sinks } = await runAndCollectSinks(content);
        for (const secret of secrets) {
          for (const sink of sinks) {
            expect(sink.includes(secret.raw)).toBe(false);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("the masked fingerprint survives into the output (the content was not merely dropped)", async () => {
    // A single deterministic secret so we can assert its fingerprint reaches the
    // File_Result sinks — proving masking happened, not silent omission.
    const raw = "AKIAABCDEFGHIJKLMNOP";
    const masked = maskSecret(raw);
    const content = `print "hi"\nk = ${raw}\n`;
    const { sinks } = await runAndCollectSinks(content);

    // No raw secret anywhere.
    for (const sink of sinks) expect(sink.includes(raw)).toBe(false);
    // The fingerprint is present in at least one sink (the before/after content).
    expect(sinks.some((s) => s.includes(masked))).toBe(true);
  });
});
