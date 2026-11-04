---
inclusion: fileMatch
fileMatchPattern: ["apps/web/**/*.tsx", "apps/web/**/*.css", "packages/ui-crt/**/*", "scripts/card-forge/**/*", "packages/cli/src/render/**/*"]
---
# Tarot UX and CRT design system

- The **spread is the layout**. Information is organized by card positions, never by generic dashboards. Each position has a label (e.g. "III · THE SHADOW") and a one-line technical subtitle.
- **Orientation is meaning**: reversed cards rotate 180° (CSS), with the subtitle overlay kept upright. Never randomize orientation.
- Card face shows: numeral, name, phosphor art, sigil, and the single most important evidence snippet (≤ 40 chars, monospace).
- Palette: background `#001a00`, phosphor `#33ff66`, dim `#1f9e45`, warning amber `#ffb000` (Devil/Tower burning only), error `#ff3355` (STILL DEAD only). Font: VT323 for display, IBM Plex Mono for evidence.
- Effects: scanlines, glow, subtle flicker; The Tower may shake 300 ms; disable all motion with `prefers-reduced-motion` or the `quiet` command.
- Ritual Mode visuals must be driven by ledger events, never fake timers.
- Accessibility: aria-live for terminal output, accessible names for cards, keyboard-first, contrast ≥ 4.5:1, every typed command also clickable.
- Art: only public-domain 1909 Pamela Colman Smith scans processed by card-forge, plus original borders/sigils. Never use the "Rider-Waite" trademark or later recolored decks.
