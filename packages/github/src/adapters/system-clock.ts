// System clock adapter: the only place (with system-fetch) allowed to touch ambient time.
import type { ClockPort } from "../ports.js";

export const systemClock: ClockPort = {
  nowMs: () => Date.now(),
};
