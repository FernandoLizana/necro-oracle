# Screenshots

Marketing screenshots for the README and the Devpost write-up. The PNGs here are
**generated**, not committed — they are produced deterministically from the
offline demo path (seeded by `DEMO_SEED`, no network) by the capture-only
Playwright spec `apps/web/e2e/screenshots.e2e.ts` (visual-necromancy task 22.1).

The generated PNG files are gitignored; this directory is kept in the repo via
this README so the capture has a destination.

## Regenerate

From the repo root (Playwright browser binaries installed once via
`pnpm --filter @necro/web exec playwright install`):

```bash
pnpm --filter @necro/web screenshots
```

That targets `screenshots.e2e.ts`, which the Playwright config detects to enable
capture (equivalently, set `CAPTURE_SCREENSHOTS=1`). It boots the real
production build, drives the demo path in full motion, and writes:

| File                       | Shot                                                        |
| -------------------------- | ----------------------------------------------------------- |
| `01-boot-logo.png`         | Boot overlay with the `NECROMANTIC SYSTEMS 1986` wordmark.  |
| `02-three-card-reading.png`| A full 3-card fates reading of framed ASCII cards.          |
| `03-tower-glitch.png`      | THE TOWER card mid/post glitch (burning, full motion).      |
| `04-resurrection-diff.png` | The unchanged diff after rot-and-rebirth.                   |

If Playwright cannot launch its bundled Chromium on the host, point it at a
locally installed browser, e.g.:

```bash
PLAYWRIGHT_CHROMIUM_CHANNEL=msedge pnpm --filter @necro/web screenshots
# or
PLAYWRIGHT_CHROMIUM_CHANNEL=chrome pnpm --filter @necro/web screenshots
```

The capture is deterministic (`DEMO_SEED` drives glitch and rot) and offline
(the demo reading loads the bundled chunk; the resurrection uses recorded
NDJSON via `mockRoutes`), so it is safe to run in CI.
