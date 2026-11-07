// @necro/ui-crt — protocol types (types only, no zod).
//
// These are the plain TypeScript interfaces the browser terminal and its
// callers share. The matching wire schemas live in
// `apps/web/src/protocol/schemas.ts`, which is checked against these types with
// a compile-time conformance assertion (design D2).
//
// The Reading shape and RepoRef are imported through the single permitted
// Client_Safe_Entry subpath `@necro/oracle/client` (R16.3). Nothing here pulls
// in a Node, tree-sitter, OSV/TOML or any other non-browser-safe dependency.
//
// Everything is written to be `exactOptionalPropertyTypes`-safe: optional
// fields use the `T | undefined` form (e.g. `demo?: true | undefined`).
//
// _Requirements: R16.3, R16.7_

import type { Reading, RepoRef } from "@necro/oracle/client";

import type { ResurrectTarget } from "./command/types.js";

/** The two spreads the terminal can play (Celtic Cross is web-only elsewhere). */
export type PlayableSpread = "fates" | "necropsy";

/**
 * The validated summary of a summon: public repo metadata only, never any
 * snapshot contents. `demo` marks a reading that came from the demo bundle.
 */
export interface SummonSummary {
  readonly ref: RepoRef; // owner, name, 40-hex sha, defaultBranch
  readonly stars: number;
  readonly hasWorkflowsDir: boolean;
  readonly degradedFields: readonly ("pulls" | "release")[];
  readonly cache: "hit" | "miss";
  readonly fileCount: number;
  readonly truncated: boolean;
  readonly demo?: true | undefined;
}

/** The final result of a reading: the summary paired with the oracle Reading. */
export interface ReadingResponse {
  readonly summary: SummonSummary;
  readonly reading: Reading;
}

/** The four ordered phases of a reading, as surfaced to the client. */
export type ReadingPhase = "SUMMON" | "DOWNLOAD" | "EXTERNAL" | "READING";

/** One decoded NDJSON progress line of the Reading_Route stream, client view. */
export type ProgressEvent =
  | { readonly kind: "phase"; readonly phase: ReadingPhase }
  | { readonly kind: "skip-note"; readonly note: string };

/** Callback the client invokes for every phase/skip-note line as it arrives. */
export type ReadProgress = (event: ProgressEvent) => void;

/**
 * The boundary to the readings API. Implementations reject with `NecroError`.
 */
export interface ApiPort {
  /** Summon a repo; rejects with NecroError. */
  summon(repo: string, signal: AbortSignal): Promise<SummonSummary>;
  /**
   * Consume the NDJSON reading stream: calls `onProgress` for every phase and
   * skip-note line as it arrives, then resolves with the validated final
   * result line.
   */
  read(
    pinned: string,
    spread: PlayableSpread,
    signal: AbortSignal,
    onProgress: ReadProgress,
  ): Promise<ReadingResponse>;
  /**
   * Consume the NDJSON resurrection stream for a `resurrect` command: POST the
   * pinned ref, the parsed target and the in-scope spread, call `onProgress`
   * for every phase and skip-note line as it arrives, then resolve with the
   * validated final `RitualResult`. Rejects with `NecroError` (R9.1-R9.3).
   */
  resurrect(
    pinned: string,
    target: ResurrectTarget,
    spread: PlayableSpread,
    signal: AbortSignal,
    onProgress: ResurrectProgress,
  ): Promise<RitualResponse>;
  /**
   * Consume the NDJSON lovers stream for a `lovers` command: POST the pinned
   * ref, the file to bind, the in-scope spread and the optional session model
   * overrides, call `onProgress` for every phase and skip-note line as it
   * arrives, then resolve with the validated final `LoversResponse`. Rejects
   * with `NecroError`, exactly like `resurrect` (lovers-binding R19.1, R19.3).
   */
  lovers(
    args: LoversRequestArgs,
    signal: AbortSignal,
    onProgress: LoversProgress,
  ): Promise<LoversResponse>;
}

/**
 * Consume the NDJSON lovers stream for a `lovers` command: POST the pinned ref,
 * the file to bind and the in-scope spread, call `onProgress` for every phase
 * and skip-note line as it arrives, then resolve with the validated final
 * `LoversResponse`. Rejects with `NecroError`, exactly like `resurrect`
 * (lovers-binding R19.1, R19.3). Added to `ApiPort` below.
 */
export interface LoversRequestArgs {
  /** The commit-pinned ref (`owner/name@<40-hex>`) of the in-scope reading. */
  readonly ref: string;
  /** The repo-relative file to bind (the resurrected Python 3 source). */
  readonly file: string;
  /** The in-scope spread (`celtic` is rejected server-side, like resurrect). */
  readonly spread: PlayableSpread;
  /** Optional BYOK model overrides, honoured by the route only on YOURS. */
  readonly models?: LoversModelOverrides | undefined;
}

/** The optional BYOK model overrides threaded from the session to the route. */
export interface LoversModelOverrides {
  readonly fast?: string | undefined;
  readonly strong?: string | undefined;
}

/** A validated, memoised bundle of demo readings keyed by demo name. */
export interface DemoBundle {
  readonly [name: string]: {
    readonly fates: ReadingResponse;
    readonly necropsy: ReadingResponse;
  };
}

/** Loads the demo bundle; validated, memoised, rejects with NecroError. */
export interface DemoPort {
  load(): Promise<DemoBundle>;
}

// ---------------------------------------------------------------------------
// Resurrection render-input types (resurrection-engine, task 14.5)
//
// These mirror the redaction-safe wire form of @necro/coven's `DiffLine`,
// `ResidualEntry` and `FileResult` (its `RitualResultSchema` / `FileResultSchema`
// / `DiffLineSchema` / `ResidualEntrySchema`). They are restated here as plain
// types — exactly as `ReadingResponse` restates the oracle Reading — so
// `@necro/ui-crt` stays browser-safe and never imports `@necro/coven` (which
// pulls node-only modules). The server validates the real wire shape; the
// terminal only needs the fields the diff/residual renderer reads.
// ---------------------------------------------------------------------------

/** One line of a per-file before/after diff (mirrors coven `DiffLine`). */
export interface ResurrectDiffLine {
  /** `add` is an inserted line (`+`), `remove` a deleted line (`-`), `context` unchanged (` `). */
  readonly kind: "add" | "remove" | "context";
  readonly text: string;
}

/** One unconverted construct the resurrection left behind (mirrors coven `ResidualEntry`). */
export interface ResurrectResidual {
  /** Source file of the unconverted construct. */
  readonly path: string;
  /** 1-based source line of the construct. */
  readonly line: number;
  /** The unconverted construct's kind/text. */
  readonly construct: string;
}

/**
 * One file's resurrection outcome (mirrors the fields of coven `FileResult`
 * the terminal renders). `fullyConverted` is `residuals.length === 0`.
 */
export interface ResurrectFileResult {
  readonly path: string;
  readonly diff: readonly ResurrectDiffLine[];
  readonly residuals: readonly ResurrectResidual[];
  readonly fullyConverted: boolean;
}

// ---------------------------------------------------------------------------
// Resurrection result (render inputs)
//
// Minimal, browser-safe mirror of the `@necro/coven` RitualResult wire shape
// (specifically the fields the terminal renders for the Vitality_Delta and the
// changed-card set). Mirrored here rather than imported so ui-crt keeps no
// `@necro/coven` dependency — exactly as `ReadingResponse` mirrors the oracle
// Reading shape above. The matching wire schema is `RitualResultSchema` in
// `@necro/coven`, re-exported as `RitualResultWireSchema` by the web route.
//
// _Requirements: R6.3, R6.4, R6.5, R9.3_
// ---------------------------------------------------------------------------

/** How a card's draw changed between the before- and after-reading (R6.4). */
export type ChangedCardKind = "added" | "removed" | "severity" | "orientation";

/** One entry of the changed-card set: the card, how it changed, and whether
 * the change is an improvement (R6.4). */
export interface ChangedCard {
  readonly card: string;
  readonly change: ChangedCardKind;
  readonly improved: boolean;
}

/**
 * The subset of the `@necro/coven` `RitualResult` the terminal renders for the
 * vitality/changed-card view. `afterVitality` and `vitalityDelta` are `null`
 * together when re-diagnosis failed (R6.5), in which case the renderer prints a
 * re-diagnosis-incomplete line instead of a delta.
 */
export interface VitalityResult {
  readonly beforeVitality: number;
  readonly afterVitality: number | null;
  readonly vitalityDelta: number | null;
  readonly changedCards: readonly ChangedCard[];
}

// ---------------------------------------------------------------------------
// Resurrection stream protocol (resurrection-engine, task 14.3)
//
// The browser view of the Resurrection_Route NDJSON stream. The six phases, the
// phase/skip-note progress events the client surfaces as it reads, and the full
// `RitualResult` the terminal resolves with. These are plain TypeScript mirrors
// of the `@necro/coven` `RitualResultSchema` wire shape — restated here (exactly
// as `ReadingResponse` mirrors the oracle Reading) so `@necro/ui-crt` and the
// browser API client stay browser-safe and never import `@necro/coven`, whose
// barrel pulls node-only modules. The matching, source-of-truth wire schema is
// `RitualResultSchema` in `@necro/coven`; the web route validates every line
// against it server-side, and the browser client re-validates against a
// pure-zod mirror (`apps/web/src/protocol/resurrect-wire.ts`) kept in lockstep
// with this type by a compile-time conformance assertion.
//
// _Requirements: R9.1, R9.2, R9.3, R14.3_
// ---------------------------------------------------------------------------

/** The six ordered resurrection phases surfaced to the client (R9.2). */
export type ResurrectionPhase =
  | "SELECT"
  | "PRE_PASS"
  | "LLM_PASS"
  | "VALIDATE"
  | "REDIAGNOSE"
  | "DIFF";

/**
 * One decoded NDJSON progress line of the Resurrection_Route stream, client
 * view: a phase line or a skip-note line. Mirrors `ProgressEvent` for the
 * reading stream, but over the six resurrection phases.
 */
export type ResurrectProgressEvent =
  | { readonly kind: "phase"; readonly phase: ResurrectionPhase }
  | { readonly kind: "skip-note"; readonly note: string };

/** Callback the client invokes for every resurrection phase/skip-note line. */
export type ResurrectProgress = (event: ResurrectProgressEvent) => void;

/**
 * The full terminal `RitualResult` the resurrection stream resolves with,
 * browser-safe mirror of the `@necro/coven` `RitualResultSchema`. Composed from
 * the render-input mirrors above (`ResurrectFileResult`, `ChangedCard`) plus the
 * top-level ritual fields the terminal reports (`patch` download, `degraded`
 * and `demo` flags). `afterVitality`/`vitalityDelta` are `null` together when
 * re-diagnosis failed (R6.5).
 */
export interface RitualResponse {
  readonly ritualId: string;
  readonly selectedCount: number;
  readonly files: readonly ResurrectFileResult[];
  readonly patch: string;
  readonly beforeVitality: number;
  readonly afterVitality: number | null;
  readonly vitalityDelta: number | null;
  readonly changedCards: readonly ChangedCard[];
  readonly degraded: boolean;
  readonly demo: boolean;
}

// ---------------------------------------------------------------------------
// Lovers stream protocol (render inputs)  (lovers-binding, task 14.4)
//
// The browser view of the Lovers_Route NDJSON stream — the four ordered phases,
// the phase/skip-note progress events the client surfaces as it reads, and the
// full `LoversResponse` the terminal resolves with. These are plain TypeScript
// mirrors of the `@necro/coven` `LoversResultSchema` wire shape — restated here
// (exactly as `ReadingResponse` mirrors the oracle Reading and `RitualResponse`
// mirrors the coven RitualResult) so `@necro/ui-crt` and the browser lovers
// client stay browser-safe and never import `@necro/coven`, whose barrel pulls
// node-only modules. The matching, source-of-truth wire schema is
// `LoversResultSchema` in `@necro/coven`; the web route validates every line
// against it server-side, and the browser client re-validates against a
// pure-zod mirror (`apps/web/src/protocol/lovers-wire.ts`) kept in lockstep with
// this type by a compile-time conformance assertion.
//
// _Requirements: R19.1, R19.3, R40.1_
// ---------------------------------------------------------------------------

/** The four ordered Lovers phases surfaced to the client (design C.5). */
export type LoversPhase = "PLAN" | "GENERATE" | "VALIDATE" | "BIND";

/**
 * One decoded NDJSON progress line of the Lovers_Route stream, client view: a
 * phase line or a skip-note line. Mirrors `ResurrectProgressEvent`, over the
 * four lovers phases.
 */
export type LoversProgressEvent =
  | { readonly kind: "phase"; readonly phase: LoversPhase }
  | { readonly kind: "skip-note"; readonly note: string };

/** Callback the client invokes for every lovers phase/skip-note line. */
export type LoversProgress = (event: LoversProgressEvent) => void;

/** One planned function parameter (mirrors coven `LoversParam`). */
export interface LoversParam {
  readonly name: string;
  readonly pyType: string;
  readonly jsonType: string;
  readonly jsType: string;
  readonly required: boolean;
}

/** The planned return-value type info (mirrors coven `LoversReturns`). */
export interface LoversReturns {
  readonly pyType: string;
  readonly jsonType: string;
  readonly jsType: string;
}

/** One planned function (mirrors coven `LoversFunction`). */
export interface LoversFunction {
  readonly name: string;
  readonly params: readonly LoversParam[];
  readonly returns: LoversReturns;
  readonly bindable: boolean;
  readonly skipReason?: string | undefined;
  readonly edgeCases: readonly string[];
}

/** One Python->JSON->JS type-mapping row (mirrors coven `LoversTypeMapEntry`). */
export interface LoversTypeMapEntry {
  readonly py: string;
  readonly json: string;
  readonly js: string;
}

/** The plan the pair was generated from (mirrors coven `LoversPlan`). */
export interface LoversPlan {
  readonly functions: readonly LoversFunction[];
  readonly typeMap: readonly LoversTypeMapEntry[];
}

/** The full assembled pair (mirrors coven `LoversPair`). */
export interface LoversPair {
  readonly jsBeloved: string;
  readonly contractSchema: string;
  readonly pythonTests: string;
  readonly jsTests: string;
  readonly pythonHeart: string;
}

/** One per-model usage subtotal (mirrors coven `UsageAggregate.byModel[]`). */
export interface LoversUsageByModel {
  readonly model: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly costUsd: number;
}

/** The reading-level "souls spent" aggregate (mirrors coven `UsageAggregate`). */
export interface LoversUsageAggregate {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly costUsd: number;
  readonly soulSource: "ORACLE" | "YOURS";
  readonly byModel: readonly LoversUsageByModel[];
}

/**
 * The full terminal `LoversResult` the lovers stream resolves with,
 * browser-safe mirror of the `@necro/coven` `LoversResultSchema`. Mirrored here
 * rather than imported so ui-crt keeps no `@necro/coven` dependency — exactly as
 * `RitualResponse` mirrors the coven RitualResult. The web route validates the
 * real wire shape; the browser `lovers-wire.ts` re-validates against a pure-zod
 * mirror kept conformant to THIS type by a compile-time assertion.
 */
export interface LoversResponse {
  readonly file: string;
  readonly targetLang: "javascript";
  readonly pair: LoversPair;
  readonly plan: LoversPlan;
  readonly path: "llm" | "template";
  readonly soulsSpent: LoversUsageAggregate;
  readonly soulSource: "ORACLE" | "YOURS";
  readonly demo: boolean;
}
