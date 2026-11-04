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
