// apps/web/src/demo/load-bundle.ts
//
// Feature: 03-crt-terminal, task 29.2 — the Demo_Bundle loader.
//
// `loadDemoBundle` lazily loads the generated `bundle.generated.json` as its
// own browser chunk (a literal-path dynamic import → separate chunk, R18.8 /
// R16.12), validates it against `DemoBundleSchema`, and memoises the resulting
// promise. On ANY failure the memo is cleared so a later retry re-attempts the
// load (R18.10) — the terminal prefetches the bundle best-effort after boot and
// retries on the first `demo <name>`.
//
// Validation and load failures surface as the two Oracle_Voice error builders
// from `@necro/ui-crt`: a schema failure rejects with `invalidResponseError()`
// (VALIDATION_FAILED, R18.9); a chunk/import failure rejects with
// `demoUnavailableError()` (NETWORK_TIMEOUT, R18.10).
//
// _Requirements: R18.8, R18.9, R18.10, R18.12, R16.12_

import {
  DEMO_CATALOG,
  demoUnavailableError,
  invalidResponseError,
} from "@necro/ui-crt";
import type { DemoBundle } from "@necro/ui-crt";
import { z } from "zod";

import { ReadingResponseSchema } from "../protocol/schemas.js";

/** A Reading_Response carried in the demo bundle: always flagged `demo: true`. */
const DemoResponseSchema = ReadingResponseSchema.refine(
  (resp) => resp.summary.demo === true,
  { message: "demo response must have summary.demo === true" },
);

/** The `{ fates, necropsy }` pair stored under each Demo_Name. */
const DemoPairSchema = z
  .object({ fates: DemoResponseSchema, necropsy: DemoResponseSchema })
  .strict();

/**
 * The Demo_Bundle schema: a record over exactly the catalog Demo_Names, each a
 * `{ fates, necropsy }` pair of demo-flagged Reading_Responses. Built from the
 * catalog so a drift between the catalog and the generated bundle is caught.
 */
export const DemoBundleSchema = z
  .object(
    Object.fromEntries(
      DEMO_CATALOG.map((entry) => [entry.name, DemoPairSchema] as const),
    ),
  )
  .strict();

/** Memoised in-flight / resolved load promise; cleared on failure so retry works. */
let memo: Promise<DemoBundle> | undefined;

/**
 * Load, validate and memoise the generated Demo_Bundle.
 *
 * The literal-path dynamic import keeps the (large) JSON out of the initial
 * route bundle and in its own lazily-loaded chunk (R18.8 / R16.12). The memo
 * guarantees repeated calls return the same bundle instance; on failure the
 * memo is cleared so a subsequent call re-attempts the load (R18.10).
 */
export function loadDemoBundle(): Promise<DemoBundle> {
  if (memo !== undefined) return memo;

  const attempt = (async (): Promise<DemoBundle> => {
    let raw: unknown;
    try {
      // Literal-path dynamic import → the bundler emits a separate chunk.
      raw = (await import("./bundle.generated.json")).default;
    } catch {
      throw demoUnavailableError();
    }

    const parsed = DemoBundleSchema.safeParse(raw);
    if (!parsed.success) {
      throw invalidResponseError();
    }

    return parsed.data as DemoBundle;
  })();

  // Clear the memo on rejection so a retry re-attempts; keep it on success.
  memo = attempt.catch((err) => {
    if (memo === attempt) memo = undefined;
    throw err;
  });

  return memo;
}
