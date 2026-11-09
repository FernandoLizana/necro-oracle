//
// SEC-07 (response headers / CORS) - every API response must LOCK the three
// defensive headers (`Cache-Control: no-store`, `X-Content-Type-Options:
// nosniff`, `Referrer-Policy: no-referrer`) at the handler level (defense in
// depth, not relying on next.config applying to streaming Response objects),
// and must NEVER echo a CORS allow-origin (same-origin only).
//
// Regression: the shared SECURITY_HEADERS carried only no-store + nosniff;
// Referrer-Policy lived ONLY in next.config.ts `/:path*`, so a streaming
// Response built directly in a handler did not carry it at the handler level.
//
// Pure: loads the real route modules; no network.
import { describe, expect, it, vi } from "vitest";

// server-only throws outside an RSC bundle; no-op it so the route modules
// (which pull in composition.ts) are importable under Vitest.
vi.mock("server-only", () => ({}));

interface RouteModule {
  readonly GET: (req: Request) => Promise<Response> | Response;
}

const ROUTES: ReadonlyArray<{ name: string; load: () => Promise<RouteModule> }> = [
  { name: "resurrect", load: () => import("./resurrect/route.js") as Promise<RouteModule> },
  { name: "lovers", load: () => import("./lovers/route.js") as Promise<RouteModule> },
  { name: "summon", load: () => import("./summon/route.js") as Promise<RouteModule> },
  { name: "readings", load: () => import("./readings/route.js") as Promise<RouteModule> },
];

describe("SEC-07 (R12.8): API responses lock no-store/nosniff/no-referrer and echo no CORS", () => {
  for (const route of ROUTES) {
    it(`${route.name}: a 405 guard response carries all three defensive headers`, async () => {
      const mod = await route.load();
      const req = new Request(`https://necro.test/api/${route.name}`, {
        method: "GET",
        headers: { origin: "https://evil.example" },
      });
      const res = await mod.GET(req);

      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    });

    it(`${route.name}: never reflects the request Origin into a CORS allow header`, async () => {
      const mod = await route.load();
      const req = new Request(`https://necro.test/api/${route.name}`, {
        method: "GET",
        headers: { origin: "https://evil.example" },
      });
      const res = await mod.GET(req);

      expect(res.headers.get("access-control-allow-origin")).toBeNull();
      expect(res.headers.get("access-control-allow-credentials")).toBeNull();
    });
  }
});
