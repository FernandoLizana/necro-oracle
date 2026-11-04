// @vitest-environment jsdom
//
// Terminal component behaviour tests (task 17.1, RED). These drive the React
// components and hooks created in task 17.2; none of them exist yet, so the
// import of `./Terminal.js` fails first (expected red).
//
// Validates: Requirements R1.1, R1.2, R1.3, R1.4, R1.5, R3.1, R3.2, R3.3,
// R3.4, R3.5, R3.6, R3.7, R3.8, R3.9, R3.10, R3.11, R3.12, R10.3, R10.4,
// R10.8, R10.11, R14.1, R14.5, R15.1, R15.2, R15.3, R15.4, R15.5, R15.11,
// R15.12, R15.13, R16.9, R17.4, R17.5
//
// The Terminal is constructed with a full set of in-memory fake ports
// (`makeFakePorts`), so every assertion is deterministic: time is advanced by
// hand through the fake `FramePort`, the reduced-motion query is flipped
// through the fake `MediaPort`, and the readings API is resolved by the test.
// No network, clock, DOM-timer or audio side effect occurs.

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BOOT_PHRASE } from "../voice/phrases.js";
import {
  makeFakePorts,
  type FakeTerminalPorts,
} from "../testing/fake-ports.js";
import {
  mockReadingResponse,
  mockSummary,
} from "../testing/mock-reading.js";

// The system under test — created by task 17.2.
import { Terminal } from "./Terminal.js";

afterEach(() => {
  cleanup();
});

/** Render `<Terminal>` with fresh fakes and return the fakes for driving it. */
function renderTerminal(
  options: Parameters<typeof makeFakePorts>[0] = {},
): FakeTerminalPorts {
  const fakes = makeFakePorts(options);
  render(<Terminal ports={fakes.ports} />);
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

/** Assert-and-return the first element of a fake-port call list (strict-safe). */
function firstCall<T>(calls: readonly T[]): T {
  expect(calls.length).toBeGreaterThanOrEqual(1);
  return calls[0] as T;
}

// ---------------------------------------------------------------------------
// Boot, focus, no-canvas, selectable text, noscript (R1)
// ---------------------------------------------------------------------------

describe("R1.1 / R1.2 (boot): the boot banner is first and the input is focused", () => {
  it("renders BOOT_PHRASE as the first output and focuses the input", async () => {
    renderTerminal();
    await waitFor(() => {
      expect(outputLog()).toHaveTextContent(BOOT_PHRASE);
    });
    // First block in the log carries the boot banner.
    const firstBlock = outputLog().querySelector("[data-kind]");
    expect(firstBlock?.textContent).toContain(BOOT_PHRASE);
    expect(document.activeElement).toBe(cmdInput());
  });
});

describe("R1.3 / R1.4 (DOM terminal): text is selectable and nothing is drawn on canvas", () => {
  it("renders the output as real DOM text, never a <canvas>", () => {
    renderTerminal();
    expect(document.querySelector("canvas")).toBeNull();
    // The banner is a text node, so `textContent` carries it verbatim.
    expect(outputLog().textContent).toContain(BOOT_PHRASE);
  });
});

describe("R1.5 (no JS): a <noscript> statement is present", () => {
  it("renders a <noscript> fallback naming the terminal", () => {
    renderTerminal();
    const noscript = document.querySelector("noscript");
    expect(noscript).not.toBeNull();
    expect((noscript as HTMLElement).textContent ?? "").toMatch(/NECRO-ORACLE/);
  });
});

// ---------------------------------------------------------------------------
// Landmarks, labels, lang, title (R15.2, R15.12)
// ---------------------------------------------------------------------------

describe("R15.2 (landmarks): the terminal exposes a named main landmark and labelled input", () => {
  it("has a main landmark with an accessible name and a labelled command input", () => {
    renderTerminal();
    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("aria-label", expect.stringMatching(/oracle/i));
    // The command input is labelled "Command".
    expect(cmdInput()).toBeInTheDocument();
  });

  it("gives the Oracle output a polite, additions-only live region", () => {
    renderTerminal();
    const log = outputLog();
    expect(log).toHaveAttribute("aria-live", "polite");
    expect(log).toHaveAttribute("aria-relevant", "additions");
  });
});

describe("R15.12 (document): the page declares English and a title", () => {
  it("has lang=en on the document and a terminal title", () => {
    renderTerminal();
    // layout.tsx sets <html lang> and <title>; in jsdom the component owns the
    // shell, so the test asserts the attributes the Screen/Terminal apply.
    expect(document.documentElement.getAttribute("lang")).toBe("en");
    expect(document.title).toMatch(/necro-oracle/i);
  });
});

// ---------------------------------------------------------------------------
// Announce-once live region (R10.4, R15.1)
// ---------------------------------------------------------------------------

describe("R10.4 / R15.1 (announce once): the full text is added once; the reveal copy is hidden", () => {
  it("adds the complete block text to the live region at append time", async () => {
    const fakes = renderTerminal();
    await waitFor(() => expect(outputLog()).toHaveTextContent(BOOT_PHRASE));

    const user = userEvent.setup();
    await user.type(cmdInput(), "help{Enter}");

    // The live copy carries the full text (clipped, still in the a11y tree).
    const live = outputLog().querySelector(".crt-live");
    expect(live).not.toBeNull();
    expect((live as HTMLElement).textContent ?? "").toMatch(/grimoire|COMMANDS/i);

    // A running reveal copy is aria-hidden, so the screen reader hears it once.
    const reveal = outputLog().querySelector(".crt-reveal");
    if (reveal !== null) {
      expect(reveal).toHaveAttribute("aria-hidden", "true");
    }
    // Drain any reveal animation so later assertions are not racing it.
    fakes.frames.advance(5000);
  });
});

// ---------------------------------------------------------------------------
// aria-busy across streamed progress (R15.3, R15.13, Q12)
// ---------------------------------------------------------------------------

describe("R15.3 / R15.13 (busy): aria-busy is set one tick after the in-progress block and kept through the result", () => {
  it("stays busy across every progress line and clears only on the result", async () => {
    const fakes = renderTerminal();
    await waitFor(() => expect(outputLog()).toHaveTextContent(BOOT_PHRASE));

    const user = userEvent.setup();
    const summary = mockSummary();

    // Summon first so a reading has a pinned ref.
    await user.type(cmdInput(), "summon spooky/crypt{Enter}");
    await waitFor(() => expect(fakes.api.summons.length).toBe(1));
    firstCall(fakes.api.summons).resolve(summary);
    await waitFor(() => expect(outputLog()).toHaveTextContent(/answers the summons/i));

    // Now read: aria-busy should become true one tick after the in-progress block.
    await user.type(cmdInput(), "read fates{Enter}");
    await waitFor(() => expect(fakes.api.reads.length).toBe(1));
    await waitFor(() => expect(outputLog()).toHaveAttribute("aria-busy", "true"));

    // Each streamed phase keeps aria-busy true.
    const read = firstCall(fakes.api.reads);
    read.emit({ kind: "phase", phase: "SUMMON" });
    read.emit({ kind: "phase", phase: "DOWNLOAD" });
    await waitFor(() => expect(outputLog()).toHaveAttribute("aria-busy", "true"));

    // The final result clears aria-busy in the same commit.
    read.resolve(mockReadingResponse());
    await waitFor(() => expect(outputLog()).toHaveAttribute("aria-busy", "false"));
  });
});

// ---------------------------------------------------------------------------
// Keyboard (R3.1–R3.7)
// ---------------------------------------------------------------------------

describe("R3.1–R3.7 (keyboard): Enter, history, Ctrl+L, Escape, Ctrl+C, Tab", () => {
  it("submits on Enter and echoes the typed command (R3.1)", async () => {
    renderTerminal();
    const user = userEvent.setup();
    await user.type(cmdInput(), "help{Enter}");
    await waitFor(() => {
      const echo = outputLog().querySelector('[data-kind="echo"]');
      expect(echo?.textContent ?? "").toContain("help");
    });
    expect(cmdInput().value).toBe("");
  });

  it("walks history with ArrowUp / ArrowDown (R3.2, R3.3)", async () => {
    renderTerminal();
    const user = userEvent.setup();
    await user.type(cmdInput(), "help{Enter}");
    await user.type(cmdInput(), "clear{Enter}");
    const input = cmdInput();
    input.focus();
    await user.keyboard("{ArrowUp}");
    expect(input.value).toBe("clear");
    await user.keyboard("{ArrowUp}");
    expect(input.value).toBe("help");
    await user.keyboard("{ArrowDown}");
    expect(input.value).toBe("clear");
  });

  it("clears the screen with Ctrl+L and prevents the browser default (R3.4)", async () => {
    renderTerminal();
    const user = userEvent.setup();
    await user.type(cmdInput(), "help{Enter}");
    await waitFor(() =>
      expect(outputLog().querySelectorAll("[data-kind]").length).toBeGreaterThan(1),
    );
    await user.keyboard("{Control>}l{/Control}");
    await waitFor(() => expect(outputLog()).toHaveTextContent(/cleared/i));
  });

  it("skips the running reveal with Escape (R3.5)", async () => {
    const fakes = renderTerminal({ storage: { "necro.motion": "on" } });
    const user = userEvent.setup();
    await user.type(cmdInput(), "help{Enter}");
    // A reveal is running (full motion); Escape completes it immediately.
    await user.keyboard("{Escape}");
    const reveal = outputLog().querySelector(".crt-reveal");
    expect(reveal).toBeNull();
    fakes.frames.advance(1);
  });

  it("aborts a running request with Ctrl+C only while in flight (R3.6)", async () => {
    const fakes = renderTerminal();
    const user = userEvent.setup();
    await user.type(cmdInput(), "summon spooky/crypt{Enter}");
    await waitFor(() => expect(fakes.api.summons.length).toBe(1));
    const { signal } = firstCall(fakes.api.summons);
    expect(signal.aborted).toBe(false);
    await user.keyboard("{Control>}c{/Control}");
    await waitFor(() => expect(signal.aborted).toBe(true));
  });

  it("never intercepts Tab (R3.7)", async () => {
    renderTerminal();
    const input = cmdInput();
    input.focus();
    const user = userEvent.setup();
    await user.keyboard("{Tab}");
    // Focus moved away from the input: Tab was not trapped.
    expect(document.activeElement).not.toBe(input);
  });
});

// ---------------------------------------------------------------------------
// Button row and equivalents (R3.8–R3.12)
// ---------------------------------------------------------------------------

describe("R3.8–R3.12 (buttons): every typed command has a clickable equivalent", () => {
  it("renders a labelled button group with the core command buttons (R3.8)", () => {
    renderTerminal();
    const group = screen.getByRole("group", { name: /command shortcuts/i });
    const names = within(group)
      .getAllByRole("button")
      .map((b) => (b.textContent ?? "").trim().toUpperCase());
    for (const label of ["HELP", "SUMMON", "READ", "DEMO", "CLEAR", "MOTION", "SOUND"]) {
      expect(names).toContain(label);
    }
  });

  it("runs HELP from its button (R3.9)", async () => {
    renderTerminal();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^help$/i }));
    await waitFor(() => expect(outputLog()).toHaveTextContent(/COMMANDS/i));
  });

  it("SUMMON fills `summon ` and focuses the input (R3.10)", async () => {
    renderTerminal();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^summon$/i }));
    expect(cmdInput().value).toBe("summon ");
    expect(document.activeElement).toBe(cmdInput());
  });

  it("SOUND is a toggle button that reports its pressed state (R3.12)", async () => {
    const fakes = renderTerminal();
    const user = userEvent.setup();
    const sound = screen.getByRole("button", { name: /^sound$/i });
    expect(sound).toHaveAttribute("aria-pressed", "false");
    await user.click(sound);
    // Clicking SOUND counts as a gesture and starts the engine.
    await waitFor(() => expect(fakes.sound.loadCount()).toBeGreaterThanOrEqual(1));
    await waitFor(() => expect(sound).toHaveAttribute("aria-pressed", "true"));
  });
});

// ---------------------------------------------------------------------------
// In-flight guard (R3.11)
// ---------------------------------------------------------------------------

describe("R3.11 (single in flight): a second request while one is running is refused", () => {
  it("answers a second summon with the ritual-underway block and makes no new call", async () => {
    const fakes = renderTerminal();
    const user = userEvent.setup();
    await user.type(cmdInput(), "summon spooky/crypt{Enter}");
    await waitFor(() => expect(fakes.api.summons.length).toBe(1));
    await user.type(cmdInput(), "summon other/repo{Enter}");
    await waitFor(() => expect(outputLog()).toHaveTextContent(/underway|Ctrl\+C/i));
    expect(fakes.api.summons.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Evidence links (R14.1, R14.5)
// ---------------------------------------------------------------------------

describe("R14.1 / R14.5 (links): the only links are evidence links, opened safely", () => {
  it("renders the evidence link with rel and target, and no other anchors", async () => {
    const fakes = renderTerminal();
    const user = userEvent.setup();
    await user.type(cmdInput(), "summon spooky/crypt{Enter}");
    await waitFor(() => expect(fakes.api.summons.length).toBe(1));
    firstCall(fakes.api.summons).resolve(mockSummary());
    await waitFor(() => expect(outputLog()).toHaveTextContent(/answers the summons/i));

    await user.type(cmdInput(), "read fates{Enter}");
    await waitFor(() => expect(fakes.api.reads.length).toBe(1));
    firstCall(fakes.api.reads).resolve(mockReadingResponse());
    await waitFor(() => expect(outputLog()).toHaveTextContent(/JUDGEMENT/i));
    fakes.frames.advance(5000);

    const anchors = Array.from(outputLog().querySelectorAll("a"));
    expect(anchors.length).toBeGreaterThanOrEqual(1);
    for (const a of anchors) {
      expect(a.getAttribute("href")).toMatch(
        /^https:\/\/github\.com\/spooky\/crypt\/blob\//,
      );
      expect(a).toHaveAttribute("target", "_blank");
      expect(a.getAttribute("rel") ?? "").toContain("noopener");
      expect(a.getAttribute("rel") ?? "").toContain("noreferrer");
    }
  });
});

// ---------------------------------------------------------------------------
// Scroll container (R17.4, R17.5)
// ---------------------------------------------------------------------------

describe("R17.4 / R17.5 (scroll): the log is the one scroll container and auto-scrolls", () => {
  it("marks the log scrollable and scrolls to the end after a block is added", async () => {
    renderTerminal();
    const log = outputLog();
    // The log is the single scroll region (tabbable so it is keyboard-scrollable).
    expect(log).toHaveAttribute("tabindex", "0");

    const scrollSpy = vi
      .spyOn(log, "scrollTop", "set")
      .mockImplementation(() => {});
    Object.defineProperty(log, "scrollHeight", { value: 10_000, configurable: true });

    const user = userEvent.setup();
    await user.type(cmdInput(), "help{Enter}");
    await waitFor(() => expect(scrollSpy).toHaveBeenCalled());
    scrollSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Reduced motion: no reveal, no idle rAF loop (R10.3, R10.11, R16.9)
// ---------------------------------------------------------------------------

describe("R10.3 / R10.11 / R16.9 (reduced): no reveal copy and no idle animation frame", () => {
  it("renders full text with no reveal copy and schedules no frame while idle", async () => {
    const fakes = renderTerminal({ prefersReducedMotion: true });
    await waitFor(() => expect(outputLog()).toHaveTextContent(BOOT_PHRASE));

    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("data-motion", "reduced");

    // No typewriter copy in reduced mode: the full text is shown directly.
    expect(outputLog().querySelector(".crt-reveal")).toBeNull();

    const user = userEvent.setup();
    await user.type(cmdInput(), "help{Enter}");
    await waitFor(() => expect(outputLog()).toHaveTextContent(/COMMANDS/i));

    // Idle in reduced mode: no animation frame is ever requested (R16.9).
    expect(fakes.frames.pending()).toBe(0);
    expect(fakes.frames.requestCount()).toBe(0);
  });

  it("drops the reveal and animation when the media query flips to reduced (R10.6/R10.3)", async () => {
    const fakes = renderTerminal({ storage: { "necro.motion": "auto" } });
    await waitFor(() => expect(outputLog()).toHaveTextContent(BOOT_PHRASE));
    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("data-motion", "full");

    fakes.media.emit(true);
    await waitFor(() => expect(main).toHaveAttribute("data-motion", "reduced"));
  });
});
