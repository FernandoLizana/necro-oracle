"use client";

// src/components/Terminal.tsx
//
// Feature: 03-crt-terminal, task 17.2.
//
// The live CRT terminal. It wires `useTerminal` to the injected ports and
// renders the exact DOM the design calls for: the `main.crt[data-motion]`
// landmark with its accessible name, the visually-hidden `<h1>`, the
// `.crt-screen` with the `role="log"` Live_Region, the Command_Line form, the
// clickable button row, the scanline/flicker layers, and the `<noscript>`
// fallback. Repository-derived text is rendered only as text nodes; the sole
// anchor is a built Evidence_Link (R14.1, R14.5).
//
// Arcana_Visions wiring (Spec 06, task 19): when a reading completes and an
// `id -> ArcanaAsset` manifest covering its drawn cards is supplied, the
// Terminal renders the pixel-art `SpreadPixelView` in place of the ASCII
// `CardReveal`, and opens the `FullscreenCardView` on a card click, Enter on a
// focused card, or an `explain <position|card>` command for a card present in
// the reading (R2.1-R2.3). An `explain` reference absent from the reading leaves
// the view unchanged — the reducer's `renderExplain`/`renderError` path still
// prints the oracle-voice error in the log (R2.4). Without a (full) manifest the
// Spec 05 behaviour is unchanged.
//
// _Requirements: R1.1-R1.5, R2.1-R2.4, R3.1, R3.*, R9.*, R10.*, R14.1, R14.5,
// R15.*, R16.9, R17.4, R17.5, R19.*_

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type { TerminalPorts } from "../ports.js";
import { useTerminal } from "../hooks/use-terminal.js";
import { BOOT_PHRASE } from "../voice/phrases.js";
import { loadCardArt } from "../render/load-card-art.js";
import type { CardArtTable } from "../render/ascii-card.js";
import { visualCards, visualCardIndex } from "../session/visual-reading.js";
import type { ArcanaAsset } from "../arcana/manifest.js";
import type { Size } from "../arcana/integer-scale.js";
import type { ExplainTarget } from "../command/types.js";
import type { VisualCard } from "../session/visual-reading.js";
import { landingVisible } from "../landing/landing-model.js";
import { Screen } from "./Screen.js";
import { OutputLog } from "./OutputLog.js";
import { Landing } from "./Landing.js";
import { CommandLine } from "./CommandLine.js";
import { ButtonRow } from "./ButtonRow.js";
import { BootOverlay } from "./BootOverlay.js";
import { SeerPortrait } from "./SeerPortrait.js";
import { CardReveal } from "./CardReveal.js";
import { SpreadPixelView } from "./SpreadPixelView.js";
import { FullscreenCardView } from "./FullscreenCardView.js";
import { NecronomiconRitual } from "./NecronomiconRitual.js";
import { RotOverlay } from "./RotOverlay.js";
import { ResurrectResultView } from "./ResurrectResultView.js";
import { VitalityCounter } from "./VitalityCounter.js";
import { ritualTimeline } from "../arcana/ritual-timeline.js";
import type { ResurrectFileResult } from "../protocol.js";

/** The accessible name of the terminal and its document title. */
const TERMINAL_LABEL = "Necro-Oracle CRT terminal";
const DOCUMENT_TITLE = "Necro-Oracle terminal";

/** Props for the Terminal. */
export interface TerminalProps {
  /** Every side effect the terminal reaches is injected through these ports. */
  readonly ports: TerminalPorts;
  /**
   * The external Boot_Skip signal, forwarded to the one-time `boot` action.
   * When `true`, the Boot_Sequence starts already settled to `phase: "done"`
   * (no overlay, no frames) while the BOOT_PHRASE still leads the log (R1.5,
   * R12.5). The host app reads the `?boot=skip` query flag into this prop
   * (visual-necromancy task 16.2); omitted / `false` plays the full boot.
   */
  readonly bootSignal?: boolean;
  /**
   * The external Ritual_Force_Flag, forwarded to the Resurrection_Ritual gate
   * as a parallel signal to `bootSignal`. The host app reads the
   * `?ritual=force` query flag into this prop (Arcana_Visions task 20). When
   * `true`, the Necronomicon ritual plays in full BEFORE the diff even during a
   * Playwright run or a `?boot=skip` load (R6.6); omitted / `false` leaves the
   * ritual gated the usual way (Reduced_Motion, a Playwright run, or
   * `?boot=skip` without the force flag all skip straight to the diff, R6.5).
   */
  readonly ritualForce?: boolean;
  /**
   * The trusted `id -> ArcanaAsset` map from `loadManifest` (Arcana_Visions).
   * When a reading completes AND this map carries the drawn cards' assets, the
   * Terminal renders the pixel-art `SpreadPixelView` and lets the user open the
   * `FullscreenCardView` on card click, Enter, or `explain <position|card>`
   * (R2.3, R3.1). Omitted / empty (the default) keeps the Spec 05 behaviour
   * exactly: the ASCII `CardReveal` spread, no pixel cards, no fullscreen — so
   * a no-manifest host renders precisely as before. The host (`apps/web`) loads
   * `apps/web/public/arcana/manifest.json` and threads `loadManifest(json)`
   * down through `TerminalScreen`; `@necro/ui-crt` never imports the app's
   * public file itself (dependency rules).
   */
  readonly manifest?: ReadonlyMap<string, ArcanaAsset>;
}

/** A sensible default spread region before the row measures itself (cards clamp to scale 1 below logical). */
const DEFAULT_SPREAD_REGION: Size = { w: 640, h: 220 };

/** The empty manifest shared as the default so no-manifest hosts behave exactly as Spec 05. */
const EMPTY_MANIFEST: ReadonlyMap<string, ArcanaAsset> = new Map();

/** The two Necronomicon frame ids and their committed image URLs (Arcana_Visions). */
const NECRONOMICON_CLOSED_ID = "necronomicon-closed";
const NECRONOMICON_OPEN_ID = "necronomicon-open";
const NECRONOMICON_CLOSED_SRC = "/arcana/necronomicon-closed.webp";
const NECRONOMICON_OPEN_SRC = "/arcana/necronomicon-open.webp";

/** The Seer landing portrait id (256×144, bands null) and its committed image URL. */
const SEER_ID = "seer";
const SEER_SRC = "/arcana/seer.webp";

/** A sensible default landing region the Seer scales into before measurement (integerScale clamps to 1 below logical). */
const DEFAULT_SEER_REGION: Size = { w: 256, h: 144 };

/**
 * Whether a detected Playwright / headless automation run is driving the page,
 * guarded for SSR. The Resurrection_Ritual is skipped during such a run unless
 * the Ritual_Force_Flag (`?ritual=force`) is set (R6.5, R6.6). `navigator`
 * absent during the server render resolves to `false` (no ritual forced off).
 */
function detectPlaywright(): boolean {
  if (typeof navigator === "undefined") return false;
  return navigator.webdriver === true;
}

/**
 * Whether the manifest carries BOTH Necronomicon frames, so the ritual has the
 * images it needs to play. Without a (full) manifest — a no-manifest Spec 05
 * host — this is `false`, so `ritualTimeline` treats the frames as not ready
 * (`imagesReady: false`) and the resurrect view renders exactly as Spec 05 did
 * (a single render straight to the diff/rot presentation).
 */
function necronomiconReady(manifest: ReadonlyMap<string, ArcanaAsset>): boolean {
  return (
    manifest.has(NECRONOMICON_CLOSED_ID) && manifest.has(NECRONOMICON_OPEN_ID)
  );
}

/**
 * The decorative rising-diff preview lines for the ritual, reconstructed from
 * the ritual's per-file diff (the `add` and `context` lines = the after-code),
 * mirroring how `RotOverlay` rebuilds the revived source. These are purely
 * decorative — `NecronomiconRitual` marks them aria-hidden — and never alter
 * the authoritative diff/patch view, which stays the `children` (R6.9).
 */
function ritualDiffLines(files: readonly ResurrectFileResult[]): string[] {
  return files.flatMap((file) =>
    file.diff
      .filter((line) => line.kind !== "remove")
      .map((line) => line.text),
  );
}

/**
 * Whether every drawn card of the current reading has a trusted asset in the
 * manifest. Only then does the pixel `SpreadPixelView` render in place of the
 * ASCII `CardReveal`; a partial / empty manifest keeps the Spec 05 ASCII spread
 * so no slot ever renders a broken pixel card. An empty reading is never a
 * pixel spread (there is nothing to frame).
 */
function pixelSpreadReady(
  cards: readonly VisualCard[],
  manifest: ReadonlyMap<string, ArcanaAsset>,
): boolean {
  if (cards.length === 0) return false;
  return cards.every((card) => manifest.has(card.draw.card));
}

/** The live CRT terminal, constructed with a full set of ports. */
export function Terminal({
  ports,
  bootSignal,
  ritualForce,
  manifest = EMPTY_MANIFEST,
}: TerminalProps): React.JSX.Element {
  // The live rot-then-rebirth playing state, reported up by `RotOverlay` (the
  // single `useRot` owner). It feeds the ambient Resurrection_Animation hum
  // gate inside `useTerminal` so the low drone hums only while the animation is
  // actively playing (visual-necromancy task 21.1, OPTIONAL polish, R13.1).
  const [resurrectionPlaying, setResurrectionPlaying] = useState(false);

  // The Fullscreen_Card_View state: whether the modal single-card inspector is
  // open and which drawn card (by index into the order-preserving `visualCards`
  // list) it shows. The parent owns this mounting decision — click, Enter, and
  // `explain <position|card>` all set it here (R2.1-R2.3) — while
  // `FullscreenCardView` owns its own focus trap, arrow navigation and Escape.
  const [fullscreen, setFullscreen] = useState<{
    readonly open: boolean;
    readonly index: number;
  }>({ open: false, index: 0 });

  // The latest drawn cards, mirrored into a ref so the stable `onExplain`
  // handler (wired into `useTerminal` below, before `cards` is computed in the
  // render body) always resolves the target against the current reading.
  const cardsRef = useRef<readonly VisualCard[]>([]);

  // `explain <position|card>`: resolve the target against the current reading's
  // drawn cards and OPEN the Fullscreen_Card_View for a present card within the
  // same submit (R2.3). A target absent from the reading (void / out-of-range /
  // card not drawn) resolves to -1, so the view is left unchanged (R2.4) — the
  // reducer's `renderExplain` path has already printed the oracle-voice error.
  const onExplain = useCallback((target: ExplainTarget) => {
    const index = visualCardIndex(cardsRef.current, target);
    if (index >= 0) {
      setFullscreen({ open: true, index });
    }
  }, []);

  const terminal = useTerminal(ports, {
    bootSignal,
    ritualForce,
    resurrectionPlaying,
    onExplain,
  });
  const {
    state,
    ariaBusy,
    rootRef,
    logRef,
    inputRef,
    submit,
    onInputKeyDown,
    prefillSummon,
    toggleSound,
    downloadPatch,
    revealedCountFor,
    engineFailed,
    bootFrameForRender,
    bootFrameKindForRender,
    visualSeed,
    ritualForce: ritualForceSignal,
  } = terminal;

  // The DOWNLOAD PATCH affordance is mounted through `ResurrectResultView`
  // below (gated on a settled `ritual`): once a resurrection Ritual has resolved
  // with a non-empty patch (R7.3, R7.4), it renders the patch-download control —
  // lazily via the `resurrectView` port when one is wired, or the plain inline
  // button otherwise. The diff/vitality blocks already render in the log; this
  // control offers the inline patch as a client-side download with no server
  // round-trip.

  // The per-CardId illustration table ships in its own lazy chunk, fetched
  // once after mount so it stays outside the first terminal render (R11.4).
  // Until it resolves, `CardReveal` falls back to the generic motif. A loaded
  // table never blocks the first paint and never changes the log text (D1).
  const [cardArt, setCardArt] = useState<CardArtTable>({});
  useEffect(() => {
    let cancelled = false;
    void loadCardArt()
      .then((loaded) => {
        if (!cancelled) setCardArt(loaded.table);
      })
      .catch(() => {
        // The generic motif is a complete fallback; a failed art chunk never
        // breaks the reading — the log already carries the card text (D1).
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The drawn cards of the current reading, in the Reading's exact order. The
  // decorative card overlay draws these over the terminal; the authoritative
  // card text stays in the log (design D1, R4.6, R12.2).
  const cards = visualCards(state);
  cardsRef.current = cards;

  // Whether the pixel-art Spread_View replaces the ASCII CardReveal: only when
  // a manifest covering every drawn card is supplied (Arcana_Visions). Without
  // it the terminal renders the Spec 05 ASCII spread, exactly as before.
  const pixelSpread = pixelSpreadReady(cards, manifest);

  // The trusted `seer` asset, if the manifest carries it (Arcana_Visions task
  // 21). When present AND the boot is playing, the Seer_Image is shown in the
  // boot/landing region; a no-manifest host leaves this `undefined` so the boot
  // renders exactly as Spec 05 did (no Seer).
  const seerAsset = manifest.get(SEER_ID);

  // The measured landing region the Seer scales itself against. Mirrors the
  // Spread_View measurement: the region measures its own box when available,
  // and `integerScale` clamps to 1 for a small region until it does.
  const seerRef = useRef<HTMLDivElement | null>(null);
  const [seerRegion, setSeerRegion] = useState<Size>(DEFAULT_SEER_REGION);
  useLayoutEffect(() => {
    const node = seerRef.current;
    if (node === null) return;
    const measure = (): void => {
      const rect = node.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setSeerRegion({ w: rect.width, h: rect.height });
      }
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [seerAsset, state.boot.phase]);

  // The measured Spread_View region each pixel card scales itself against. The
  // row measures its own box (ResizeObserver when available); until measured it
  // uses a sensible default, and `integerScale` clamps to 1 for a small region.
  const spreadRef = useRef<HTMLDivElement | null>(null);
  const [spreadRegion, setSpreadRegion] = useState<Size>(DEFAULT_SPREAD_REGION);
  useLayoutEffect(() => {
    const node = spreadRef.current;
    if (node === null) return;
    const measure = (): void => {
      const rect = node.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setSpreadRegion({ w: rect.width, h: rect.height });
      }
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [pixelSpread]);

  // Open the Fullscreen_Card_View for a clicked / Enter-activated card (R2.1,
  // R2.2). The click/Enter both land on `PixelCard`'s `onActivate` (a button-
  // like activation on the card root), carrying the card's index in the spread.
  const openFullscreenAt = useCallback((index: number) => {
    setFullscreen({ open: true, index });
  }, []);

  const closeFullscreen = useCallback(() => {
    setFullscreen((prev) => ({ ...prev, open: false }));
  }, []);

  const changeFullscreenIndex = useCallback((index: number) => {
    setFullscreen((prev) => ({ ...prev, index }));
  }, []);

  // A reading that no longer holds the open card (cleared log, fresh `read`)
  // closes the inspector so it never points past the end of the spread.
  useEffect(() => {
    if (fullscreen.open && fullscreen.index >= cards.length) {
      setFullscreen({ open: false, index: 0 });
    }
  }, [cards.length, fullscreen.open, fullscreen.index]);

  // ── Landing activation: summon a concrete repo, THEN read fates (R5.1) ────
  //
  // The DMG Landing's concrete-repo activation must `summon <ref>` and then
  // `read fates`, with the read actually happening against the summoned repo.
  // The reducer allows only ONE in-flight request: `doSummon` sets
  // `state.inflight`, so a synchronous second `submit("read fates")` would hit
  // the `inflight !== null` guard in `doRead` and be rejected. So the read is
  // CHAINED after the summon RESOLVES rather than fired in the same tick.
  //
  // `onSummonAndRead` dispatches the summon and records a "pending auto-read"
  // intent in a ref; the effect below watches for that summon settling and
  // dispatches `read fates` exactly once. This is ONLY the landing path — typed
  // commands (`summon x` then `read fates`) are untouched and still hit the
  // reducer exactly as before.
  const pendingReadAfterSummonRef = useRef(false);
  // The in-flight value on the previous render, so the effect can see the
  // summon transition from non-null back to null (the settle edge).
  const prevInflightRef = useRef(state.inflight);

  const onSummonAndRead = useCallback(
    (ref: string) => {
      // Arm the auto-read BEFORE dispatching so the settle edge below is never
      // missed, then run the summon exactly as a button submit would.
      pendingReadAfterSummonRef.current = true;
      submit(`summon ${ref}`, "button");
    },
    [submit],
  );

  // Watch for the armed summon settling and chain `read fates` once. The summon
  // settles when `inflight` goes from non-null back to `null`. On SUCCESS the
  // reducer has set `state.summary` to the summoned repo, so we read against it
  // (R5.1). On FAILURE (`api.failed`) `inflight` also returns to null but
  // `summary` stays null — the landing path only ever arms this while
  // `summary === null`, so a null summary at the settle edge means the summon
  // did not land and we clear the flag WITHOUT reading (no stray `read fates`
  // against nothing). The flag is cleared in BOTH branches so this fires at
  // most once per activation and never loops.
  useEffect(() => {
    const prevInflight = prevInflightRef.current;
    prevInflightRef.current = state.inflight;

    if (!pendingReadAfterSummonRef.current) return;
    // Still summoning (or the summon has not been dispatched yet): wait.
    if (state.inflight !== null) return;
    // No settle edge this render (inflight was already null): wait for the
    // summon we armed to actually start and then settle.
    if (prevInflight === null) return;
    // Only react to the summon we armed, not a read/resurrect/demo settle.
    if (prevInflight.kind !== "summon") return;

    // The armed summon has settled. Clear the flag first so we fire exactly
    // once, then read fates only if the summon actually produced a summary.
    pendingReadAfterSummonRef.current = false;
    if (state.summary !== null) {
      submit("read fates", "button");
    }
  }, [state.inflight, state.summary, submit]);

  // A settled resurrection: the decorative rot-then-rebirth overlay plays over
  // the terminal while the diff / Vitality_Delta live in the log (R6.1, R6.10).
  const ritual = state.lastRitual;

  // Stable callback the `RotOverlay` reports its rot-playing state through, so
  // the ambient hum gate follows the overlay's single `useRot` (task 21.1).
  const onRotPlayingChange = useCallback((playing: boolean) => {
    setResurrectionPlaying(playing);
  }, []);

  // ── Resurrection_Ritual wiring (Arcana_Visions task 20) ──────────────────
  //
  // When a resurrection settles, gate the Spec 05 diff/rot presentation through
  // the pure `ritualTimeline`: in full motion (or when the Ritual_Force_Flag is
  // set) the Necronomicon_Ritual plays its four phases BEFORE the diff, then
  // renders the SAME RotOverlay + Vitality + log view verbatim as its
  // `children`; otherwise the timeline is empty and that view renders in a
  // single render, exactly as Spec 05 did. Demo determinism (R6.7, R6.8) rides
  // `visualSeed` (DEMO_SEED in demo). The ritual only plays when the manifest
  // carries both Necronomicon frames; a no-manifest host keeps the Spec 05 path
  // (frames treated as not ready).

  // A detected Playwright / headless run, captured once on mount (SSR-guarded).
  // During such a run the ritual is skipped unless `?ritual=force` is set.
  const [playwright] = useState<boolean>(detectPlaywright);

  // Whether the Necronomicon frames are available to the ritual (manifest has
  // both ids). Without them the resurrect view stays on the Spec 05 path.
  const necronomiconAvailable = necronomiconReady(manifest);

  // Track the ritual whose Necronomicon animation has already played so a
  // re-render never replays it; a fresh resurrection (new `lastRitual`) resets.
  const [playedRitualId, setPlayedRitualId] = useState<string | null>(null);

  // Image-decode failure on either Necronomicon frame: skip straight to the
  // diff for this ritual (and every re-render of it) by marking it played.
  const onRitualImageError = useCallback((ritualId: string) => {
    setPlayedRitualId(ritualId);
  }, []);

  // The component owns the document shell attributes in environments where the
  // framework layout has not already set them (R15.12). It also flags that the
  // client has mounted (`data-js="ready"`), which lets the CSS hide the static
  // no-JS fallback note (R1.5) now that the live terminal is present — a plain
  // DOM property write, no inline script, so it is CSP-safe (R14.9).
  //
  // The Boot_Sequence NEVER defers this write: `data-js="ready"` is set
  // unconditionally and immediately in this mount effect, exactly as before, so
  // the `#no-js-note` is hidden the moment the client mounts regardless of boot
  // state (visual-necromancy D1, R10.4). The boot plays as an overlay over the
  // already-mounted terminal; it does not gate, delay, or replace this effect.
  useEffect(() => {
    document.documentElement.lang = "en";
    document.documentElement.dataset.js = "ready";
    document.title = DOCUMENT_TITLE;
  }, []);

  return (
    <main
      ref={rootRef as React.Ref<HTMLElement>}
      className="crt"
      data-motion={state.motionMode}
      // The global `.crt :focus-visible` ring is now the in-palette COMPOSED
      // indicator (`#8cff9e` outline + `#001a00` offset, oracle-landing-polish
      // R32), so every control — including the `NECRO>` input while the landing
      // is visible — already gets a DMG_Palette focus ring from the global rule.
      // The former `data-landing="visible"` marker, which only existed to scope
      // a landing-only `--dmg-3` ring override onto the input, is therefore no
      // longer needed and has been removed.
      aria-label={TERMINAL_LABEL}
    >
      <h1 className="crt-sr-only">Necro-Oracle terminal</h1>
      <Screen>
        {/* The one-time Boot_Sequence overlay, drawn over the already-mounted
            terminal. It renders nothing once the boot phase settles to "done"
            (reduced motion / bootSignal / skipped / completed), so the ready
            terminal carries no leftover overlay (R1.1, R1.7, R10.4).

            Arcana_Visions (task 21): while the boot is playing AND the manifest
            carries the `seer` asset, the Seer_Image — the oracle's face — is
            shown in the boot/landing region at integer scale, with the existing
            text boot overlay as its onError fallback (R7.1, R7.4). A no-manifest
            Spec 05 host (no `seer` entry) renders the boot exactly as before: no
            Seer, just the `BootOverlay`. The BootOverlay keeps its a11y intact —
            the `crt-sr-only` wordmark and skip hint — regardless of the Seer. */}
        {seerAsset !== undefined && state.boot.phase === "playing" ? (
          <div ref={seerRef} className="crt-seer-region" data-boot-seer="playing">
            {/* The oracle's face. On image error it swaps IN PLACE for `null`
                (no broken-image indicator) and the sibling `BootOverlay` below
                remains the text landing — so a failed Seer image degrades to
                exactly the Spec 05 boot (R7.4). */}
            <SeerPortrait
              asset={seerAsset}
              available={seerRegion}
              src={SEER_SRC}
              fallback={null}
            />
            {/* Exactly ONE boot overlay renders at a time. It sits alongside the
                Seer so the boot frames, the accessible `crt-sr-only` wordmark
                and the skip hint stay present while the oracle's face shows
                (a11y + skip intact, R1.4, R1.8). */}
            <BootOverlay
              frame={bootFrameForRender}
              bootPhase={state.boot.phase}
              frameKind={bootFrameKindForRender}
            />
          </div>
        ) : (
          <BootOverlay
            frame={bootFrameForRender}
            bootPhase={state.boot.phase}
            frameKind={bootFrameKindForRender}
          />
        )}
        {/* The DMG Landing_State region (oracle-landing-polish, Part A). It
            sits where the empty idle screen is — a sibling ABOVE the OutputLog,
            next to the boot/seer region — and renders only on the fresh,
            post-boot, pre-command idle screen. `Landing` returns `null` unless
            `landingVisible(state)`, so it never coexists with a reading spread,
            the ritual, or a populated log; the gate here mirrors that predicate
            so the region is additive and never double-counts. The command line,
            the command chips, and the `NECRO>` input stay mounted and operable
            throughout — the landing is a presentational region, not a modal, and
            traps no focus (R1.1, R1.3, R1.6, R7.8, R7.9). `focusInput` is the
            Spec 03 `prefillSummon` (it focuses — and prefills `summon ` on — the
            NECRO> input), which is the focus-input effect the ENTER row needs. */}
        {landingVisible(state) ? (
          <Landing
            state={state}
            manifest={manifest}
            motionMode={state.motionMode}
            seerSrc={SEER_SRC}
            available={seerRegion}
            submit={submit}
            onSummonAndRead={onSummonAndRead}
            focusInput={prefillSummon}
          />
        ) : null}
        <OutputLog
          ref={logRef}
          blocks={state.log}
          ariaBusy={ariaBusy}
          revealedCountFor={revealedCountFor}
          engineFailed={engineFailed}
        />
        {/* Card layer. With an Arcana_Visions manifest covering the reading's
            drawn cards, the pixel-art `SpreadPixelView` renders the spread as
            integer-scaled Pixel_Cards (each with its own ASCII + no-JS fallback)
            and each card opens the `FullscreenCardView` on click / Enter (R2.1,
            R2.2, R3.1). Without a (full) manifest the Spec 05 decorative ASCII
            `CardReveal` renders exactly as before — one framed card per drawn
            position, in order, with the one-by-one flip + severity glitch,
            aria-hidden (the log owns the announced text, D1). */}
        {pixelSpread ? (
          <div ref={spreadRef} className="crt-spread-pixel-region">
            <SpreadPixelView
              cards={cards}
              manifest={manifest}
              available={spreadRegion}
              motionMode={state.motionMode}
              art={cardArt}
              onActivateCard={openFullscreenAt}
            />
          </div>
        ) : (
          <CardReveal
            cards={cards}
            flippedCount={state.cardReveal.flippedCount}
            motionMode={state.motionMode}
            art={cardArt}
          />
        )}
        {/* The modal single-card inspector, mounted only while open. It moves
            focus inside on open and restores it to the opener on close, traps
            Tab, wraps arrow navigation, and closes on Escape (R2.5-R2.8). */}
        {fullscreen.open && cards.length > 0 ? (
          <FullscreenCardView
            cards={cards}
            index={fullscreen.index}
            manifest={manifest}
            motionMode={state.motionMode}
            onIndexChange={changeFullscreenIndex}
            onClose={closeFullscreen}
          />
        ) : null}
        {/* Decorative resurrection layer: the rot-then-rebirth animation plays
            over the terminal while the diff / Vitality_Delta stay in the log.
            Arcana_Visions wraps this presentation in the Necronomicon_Ritual:
            in full motion (or when forced) the four-phase book animation plays
            FIRST, then renders this exact view verbatim as its `children`; when
            the timeline is empty (Reduced_Motion, a Playwright / `?boot=skip`
            run without the force flag, or no Necronomicon frames) the children
            render in a single render, preserving the Spec 05 behaviour (R6.9). */}
        {ritual !== null ? (
          <NecronomiconRitual
            key={ritual.ritualId}
            steps={
              playedRitualId === ritual.ritualId
                ? []
                : ritualTimeline({
                    motionMode: state.motionMode,
                    playwright,
                    bootSkip: bootSignal ?? false,
                    ritualForce: ritualForceSignal,
                    seed: visualSeed,
                    imagesReady: necronomiconAvailable,
                  })
            }
            frames={ports.frames}
            motionMode={state.motionMode}
            closedSrc={NECRONOMICON_CLOSED_SRC}
            openSrc={NECRONOMICON_OPEN_SRC}
            diffLines={ritualDiffLines(ritual.files)}
            onImageError={() => onRitualImageError(ritual.ritualId)}
            onComplete={() => setPlayedRitualId(ritual.ritualId)}
          >
            <RotOverlay
              files={ritual.files}
              seed={visualSeed}
              motionMode={state.motionMode}
              frames={ports.frames}
              onPlayingChange={onRotPlayingChange}
            />
            {/* OPTIONAL decorative Vitality_Delta count-up (task 21.3). It
                counts before -> after alongside the rebirth. aria-hidden — the
                authoritative delta is announced once from the log (D1). */}
            <VitalityCounter
              beforeVitality={ritual.beforeVitality}
              afterVitality={ritual.afterVitality}
              motionMode={state.motionMode}
              frames={ports.frames}
            />
          </NecronomiconRitual>
        ) : null}
        <CommandLine
          ref={inputRef}
          onSubmit={(raw) => submit(raw, "enter")}
          onKeyDown={onInputKeyDown}
        />
        <ButtonRow
          submit={submit}
          prefillSummon={prefillSummon}
          toggleSound={toggleSound}
          soundOn={state.sound.preference === "on"}
        />
        {/* The resurrection result view's patch-download control. Mounted
            through the `resurrectView` port (oracle-landing-polish, Part B bug
            2): once a Ritual settles with a non-empty patch and a host wired the
            port, the concrete `ResurrectionResult` is lazily loaded from its own
            bundler chunk and renders its own download control here — the piece
            not already in the authoritative log — keeping that chunk live and
            off the initial route (R9.2-R9.5). Until it resolves (and whenever no
            port is wired) the plain inline `DOWNLOAD PATCH` button renders, so
            the download is always reachable and a port-less host behaves exactly
            as before. The authoritative diff / Vitality_Delta stay in the log. */}
        {ritual !== null ? (
          <ResurrectResultView
            port={ports.resurrectView}
            patch={ritual.patch}
            ritualId={ritual.ritualId}
            onDownload={downloadPatch}
          />
        ) : null}
      </Screen>
      <noscript>{`${BOOT_PHRASE} — The terminal requires JavaScript.`}</noscript>
    </main>
  );
}
