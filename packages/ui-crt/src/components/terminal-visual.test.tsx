// @vitest-environment jsdom
//
// Terminal Visual_Layer wiring — integration tests (visual-necromancy task 16.3).
//
// These exercise the Terminal as the user sees it with the Visual_Layer wired
// in (task 16.1): the `BootOverlay`, the decorative `CardReveal` card layer
// (`.crt-card-reveal` / `.crt-card-slot`), and the `RotOverlay`, all driven by
// `useTerminal` over the in-memory fake ports. Time is advanced by hand through
// the fake `FramePort`; the reduced-motion query is flipped through the fake
// `MediaPort`; the readings API is resolved by the test. No network, real
// clock, DOM timer, or unseeded randomness is used.
//
// Validates: Requirements R4.1, R4.2, R4.5, R4.7, R4.8, R10.1, R10.4, R12.1,
// R12.4

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { getCard } from "@necro/oracle/client";

import { BOOT_PHRASE } from "../voice/phrases.js";
import {
  makeFakePorts,
  type FakePortsOptions,
  type FakeTerminalPorts,
} from "../testing/fake-ports.js";
import { mockReadingResponse, mockSummary } from "../testing/mock-reading.js";
import type { ReadingResponse } from "../protocol.js";

import { Terminal } from "./Terminal.js";

afterEach(() => {
  cleanup();
});

/** Render `<Terminal>` with fresh fakes and return the fakes for driving it. */
function renderTerminal(
  options: FakePortsOptions = {},
  props: { readonly bootSignal?: boolean } = {},
): FakeTerminalPorts {
  const fakes = makeFakePorts(options);
  render(
    props.bootSignal === undefined ? (
      <Terminal ports={fakes.ports} />
    ) : (
      <Terminal ports={fakes.ports} bootSignal={props.bootSignal} />
    ),
  );
  return fakes;
}

/** The command input, by its accessible label (R15.2). */
function cmdInput(): HTMLInputElement {
  return screen.getByRole("textbox", { name: /command/i }) as HTMLInputElement;
}

/** The live Oracle output log (role="log"). */
function outputLog(): HTMLElement {
  return screen.getByRole("log");
}

/** The decorative card layer and its per-position card slots. */
function cardSlots(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".crt-card-slot"));
}

/** Assert-and-return the first element of a fake-port call list (strict-safe). */
function firstCall<T>(calls: readonly T[]): T {
  expect(calls.length).toBeGreaterThanOrEqual(1);
  return calls[0] as T;
}

/**
 * Summon then read, resolving both from a mock, so a full reading (summary +
 * two drawn cards) lands in the log and the Visual_Layer seeds its card reveal.
 */
async function resolveReading(
  fakes: FakeTerminalPorts,
  user: ReturnType<typeof userEvent.setup>,
  response: ReadingResponse = mockReadingResponse(),
): Promise<void> {
  await user.type(cmdInput(), "summon spooky/crypt{Enter}");
  await waitFor(() => expect(fakes.api.summons.length).toBe(1));
  firstCall(fakes.api.summons).resolve(mockSummary());
  await waitFor(() => expect(outputLog()).toHaveTextContent(/answers the summons/i));

  await user.type(cmdInput(), "read fates{Enter}");
  await waitFor(() => expect(fakes.api.reads.length).toBe(1));
  firstCall(fakes.api.reads).resolve(response);
}

/** The uppercase card name a reading position renders in the log. */
const JUDGEMENT = getCard("judgement").name.toUpperCase();
const TOWER = getCard("tower").name.toUpperCase();

/** Count non-overlapping occurrences of `needle` in `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    count++;
    from = at + needle.length;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Boot phrase first + data-js="ready" immediate, in every path (R10.4, R1.2)
// ---------------------------------------------------------------------------

describe("R10.4 (boot first, js ready): the boot phrase leads the log and data-js is set immediately in all paths", () => {
  it("full-motion boot: boot phrase is the first Output_Block and data-js=ready is set at once", async () => {
    renderTerminal({ storage: { "necro.motion": "on" } });
    // The mount effect sets data-js="ready" immediately, never deferred by boot.
    expect(document.documentElement.dataset.js).toBe("ready");
    await waitFor(() => expect(outputLog()).toHaveTextContent(BOOT_PHRASE));
    const firstBlock = outputLog().querySelector("[data-kind]");
    expect(firstBlock?.textContent).toContain(BOOT_PHRASE);
  });

  it("bootSignal=true: boot phrase still leads and data-js=ready is set at once", async () => {
    renderTerminal({ storage: { "necro.motion": "on" } }, { bootSignal: true });
    expect(document.documentElement.dataset.js).toBe("ready");
    await waitFor(() => expect(outputLog()).toHaveTextContent(BOOT_PHRASE));
    const firstBlock = outputLog().querySelector("[data-kind]");
    expect(firstBlock?.textContent).toContain(BOOT_PHRASE);
    // No boot overlay lingers once the boot starts settled.
    expect(document.querySelector(".crt-boot-overlay")).toBeNull();
  });

  it("reduced motion: boot phrase still leads and data-js=ready is set at once", async () => {
    renderTerminal({ prefersReducedMotion: true });
    expect(document.documentElement.dataset.js).toBe("ready");
    await waitFor(() => expect(outputLog()).toHaveTextContent(BOOT_PHRASE));
    const firstBlock = outputLog().querySelector("[data-kind]");
    expect(firstBlock?.textContent).toContain(BOOT_PHRASE);
  });
});

// ---------------------------------------------------------------------------
// Card reveal flips in order and typewriters each diagnosis (R4.1, R4.2, R12.1)
// ---------------------------------------------------------------------------

describe("R4.1 / R4.2 / R12.1 (reveal order): cards flip one-by-one in spread order and the log owns the diagnosis text", () => {
  it("draws one slot per drawn position in spread order and flips them in order as the clock advances", async () => {
    const fakes = renderTerminal(
      { storage: { "necro.motion": "on" } },
      { bootSignal: true },
    );
    const user = userEvent.setup();
    await resolveReading(fakes, user);

    // The decorative card layer draws one slot per drawn position, in order.
    await waitFor(() => expect(cardSlots().length).toBe(2));
    const slots = cardSlots();
    expect(slots.map((s) => s.dataset.position)).toEqual(["1", "2"]);

    // Before any reveal tick both cards are face-down (Card_Back).
    expect(slots.map((s) => s.dataset.flipped)).toEqual(["false", "false"]);

    // The first reveal tick records the start clock; the card schedule then
    // flips card 0 once elapsed crosses its flip-done offset (CARD_FLIP_MS).
    fakes.frames.advance(1);
    fakes.frames.advance(700);
    await waitFor(() => {
      expect(cardSlots()[0]?.dataset.flipped).toBe("true");
    });
    // Card 1 has NOT flipped yet — the reveal is strictly one-by-one in order.
    expect(cardSlots()[1]?.dataset.flipped).toBe("false");

    // Advancing well past card 0's typewriter flips card 1 too.
    fakes.frames.advance(10_000);
    await waitFor(() => {
      expect(cardSlots()[1]?.dataset.flipped).toBe("true");
    });
    expect(cardSlots().map((s) => s.dataset.flipped)).toEqual(["true", "true"]);

    // The authoritative card text lives in the role="log" region, never the
    // aria-hidden decorative overlay (D1, R12.1).
    const reveal = document.querySelector(".crt-card-reveal");
    expect(reveal).toHaveAttribute("aria-hidden", "true");
    expect(outputLog()).toHaveTextContent(JUDGEMENT);
    expect(outputLog()).toHaveTextContent(TOWER);
  });
});

// ---------------------------------------------------------------------------
// Escape completes all (R4.5)
// ---------------------------------------------------------------------------

describe("R4.5 (Escape completes all): pressing Escape mid-reveal flips every card and finishes every diagnosis", () => {
  it("flips every slot face-up and leaves no running reveal copy", async () => {
    const fakes = renderTerminal(
      { storage: { "necro.motion": "on" } },
      { bootSignal: true },
    );
    const user = userEvent.setup();
    await resolveReading(fakes, user);

    await waitFor(() => expect(cardSlots().length).toBe(2));
    // Kick the reveal so it is mid-flight (card 0 up, card 1 still down).
    fakes.frames.advance(1);
    fakes.frames.advance(700);
    await waitFor(() => expect(cardSlots()[0]?.dataset.flipped).toBe("true"));
    expect(cardSlots()[1]?.dataset.flipped).toBe("false");

    // Escape completes the whole reveal: every card flipped, every diagnosis
    // fully revealed (no .crt-reveal typewriter copy remains).
    cmdInput().focus();
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(cardSlots().every((s) => s.dataset.flipped === "true")).toBe(true);
    });
    expect(outputLog().querySelector(".crt-reveal")).toBeNull();
    fakes.frames.advance(1);
  });
});

// ---------------------------------------------------------------------------
// Reduced motion renders all cards face-up in one render (R12.4-adjacent)
// ---------------------------------------------------------------------------

describe("R12.4 (reduced motion): every card renders face-up in one render with no flip animation", () => {
  it("shows every slot already flipped immediately after the reading resolves", async () => {
    const fakes = renderTerminal({ prefersReducedMotion: true });
    const user = userEvent.setup();
    await resolveReading(fakes, user);

    await waitFor(() => expect(cardSlots().length).toBe(2));
    // No frame tick needed: all cards face-up in the single render (R4.4).
    expect(cardSlots().every((s) => s.dataset.flipped === "true")).toBe(true);
    // Reduced motion schedules no animation frame to flip cards.
    expect(fakes.frames.pending()).toBe(0);
    expect(fakes.frames.requestCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Live_Region receives each card once (R4.7, R10.1)
// ---------------------------------------------------------------------------

describe("R4.7 / R10.1 (announce once): each card's diagnosis appears exactly once in the log", () => {
  it("renders each position's card name exactly once in the authoritative log", async () => {
    const fakes = renderTerminal(
      { storage: { "necro.motion": "on" } },
      { bootSignal: true },
    );
    const user = userEvent.setup();
    await resolveReading(fakes, user);

    await waitFor(() => expect(outputLog()).toHaveTextContent(JUDGEMENT));
    // Drain the reveal so every block renders its authoritative copy directly
    // (no aria-hidden .crt-reveal prefix copy left to double-count).
    fakes.frames.advance(1);
    fakes.frames.advance(20_000);
    await waitFor(() =>
      expect(outputLog().querySelector(".crt-reveal")).toBeNull(),
    );

    const logText = outputLog().textContent ?? "";
    expect(countOccurrences(logText, JUDGEMENT)).toBe(1);
    expect(countOccurrences(logText, TOWER)).toBe(1);

    // The decorative overlay is aria-hidden, so it adds no second announcement.
    const reveal = document.querySelector(".crt-card-reveal");
    expect(reveal).toHaveAttribute("aria-hidden", "true");
  });
});

// ---------------------------------------------------------------------------
// Empty spread renders nothing (R4.8)
// ---------------------------------------------------------------------------

describe("R4.8 (empty spread): a reading with no drawn positions renders no card slot and no error", () => {
  it("draws no .crt-card-slot and raises no error for an empty reading", async () => {
    const empty = mockReadingResponse();
    const emptyReading: ReadingResponse = {
      summary: empty.summary,
      reading: { ...empty.reading, spread: [], draws: [] },
    };
    const fakes = renderTerminal({ storage: { "necro.motion": "on" } }, { bootSignal: true });
    const user = userEvent.setup();
    await resolveReading(fakes, user, emptyReading);

    // The reading resolved into the log; the decorative card layer draws nothing.
    await waitFor(() => expect(outputLog()).toHaveTextContent(/VITALITY/i));
    expect(cardSlots().length).toBe(0);
    expect(document.querySelector(".crt-card-reveal")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// `motion` command switches effects live (R12.4)
// ---------------------------------------------------------------------------

describe("R12.4 (motion switch): the motion command flips the effect mode live", () => {
  it("typing `motion off` switches to reduced and `motion on` re-enables full", async () => {
    renderTerminal({ storage: { "necro.motion": "on" } }, { bootSignal: true });
    const user = userEvent.setup();
    const main = screen.getByRole("main");
    await waitFor(() => expect(main).toHaveAttribute("data-motion", "full"));

    await user.type(cmdInput(), "motion off{Enter}");
    await waitFor(() => expect(main).toHaveAttribute("data-motion", "reduced"));

    await user.type(cmdInput(), "motion on{Enter}");
    await waitFor(() => expect(main).toHaveAttribute("data-motion", "full"));
  });

  it("flips to reduced live when the system reduced-motion query changes", async () => {
    const fakes = renderTerminal({ storage: { "necro.motion": "auto" } }, { bootSignal: true });
    const main = screen.getByRole("main");
    await waitFor(() => expect(main).toHaveAttribute("data-motion", "full"));
    fakes.media.emit(true);
    await waitFor(() => expect(main).toHaveAttribute("data-motion", "reduced"));
  });
});
