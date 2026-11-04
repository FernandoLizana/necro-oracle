// apps/web/src/app/api/routes.test.ts
//
// Feature: 03-crt-terminal, task 27.1 (TEST-FIRST).
//
// Example tests for the two App Router route modules
// (`app/api/summon/route.ts`, `app/api/readings/route.ts`; design.md
// §"Route files"; R6.11, R12.2).
//
// TEST-FIRST (red). This file is written BEFORE task 27.2 creates the real
// route modules. It is red for the expected reason until then:
//   - `./summon/route.js` does not exist yet, and
//   - `./readings/route.js` currently holds the task-1.2 GET spike (a
//     throwaway `GET`), NOT the real POST route. This suite asserts the REAL
//     contract (a POST function, non-POST 405s, `maxDuration = 50`), which the
//     spike cannot satisfy — so even the readings import that resolves still
//     produces the correct red.
//
// Why `vi.mock("server-only")`: each route module imports `getRouteDeps` from
// `../../../server/composition.js`, whose first line is `import "server-only"`
// (it throws outside an RSC bundle). The mock no-ops it so the route module is
// importable under Vitest. We also provide the minimal `process.env` the
// composition root reads so that *if* `getRouteDeps()` were ever evaluated it
// would not throw; the route config consts and the method guards exercised
// here do NOT call `getRouteDeps()` (it is invoked lazily only inside `POST`),
// so no real GitHub/network/Upstash work happens. `NECRO_DAILY_REQUEST_CEILING`
// and `NECRO_CLIENT_IP_HEADER` have schema defaults; `GITHUB_TOKEN` is
// optional; with no `UPSTASH_*` keys the limiter chain uses `primary: null`.
//
// The exported surface this file pins (recorded for task 27.2 — both route
// modules must match):
//   summon/route.ts, readings/route.ts
//     export const runtime = "nodejs";
//     export const dynamic = "force-dynamic";
//     export const maxDuration = 50;                       // R6.11
//     export const POST: (req: Request) => Promise<Response> | Response;
//     export const GET  = methodNotAllowed;                // 405 contract
//     export const PUT  = methodNotAllowed;                //   "
//     export const PATCH = methodNotAllowed;               //   "
//     export const DELETE = methodNotAllowed;              //   "
//     export const OPTIONS = methodNotAllowed;             //   "
//     export const HEAD = methodNotAllowed;                //   "
//   Each non-POST handler returns 405 with `Allow: POST`,
//   `Cache-Control: no-store`, and a `{ error: { code: "VALIDATION_FAILED",
//   userMessage } }` Error_Envelope body (HEAD carries NO body) — exactly the
//   shared `methodNotAllowed(req)` guard (design.md §"Handler pipeline",
//   guard.ts). Each export is driven with a `Request` whose `method` matches
//   its name so the guard's HEAD-no-body branch is exercised correctly.
//
// No network / LLM / sandbox: the POST happy path is NOT exercised here (that
// is tasks 25/26); this file only pins the route config consts, that POST is
// wired, and the non-POST 405 contract.
//
// _Requirements: R6.11, R12.2, R14.9_
import { beforeAll, describe, expect, it, vi } from "vitest";

// `server-only` throws when imported outside an RSC bundle; no-op it so the
// route modules (which transitively import the composition root) are importable
// under Vitest. MUST be hoisted above the dynamic imports below.
vi.mock("server-only", () => ({}));

// Minimal env the composition root would read if `getRouteDeps()` were ever
// evaluated. The route config consts and the method guards exercised here do
// not call it, but we set these so the module is safe to import regardless.
beforeAll(() => {
  process.env["NECRO_DAILY_REQUEST_CEILING"] ??= "1000";
  process.env["NECRO_CLIENT_IP_HEADER"] ??= "x-real-ip";
});

/** The non-POST method handler names every route module must export. */
const NON_POST_METHODS = [
  "GET",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "HEAD",
] as const;
type NonPostMethod = (typeof NON_POST_METHODS)[number];

/** A route module's public shape (as this suite asserts it). */
interface RouteModule {
  readonly runtime: unknown;
  readonly dynamic: unknown;
  readonly maxDuration: unknown;
  readonly POST: unknown;
  readonly GET: unknown;
  readonly PUT: unknown;
  readonly PATCH: unknown;
  readonly DELETE: unknown;
  readonly OPTIONS: unknown;
  readonly HEAD: unknown;
}

/**
 * The two real route modules under test. `readings/route.ts` currently holds
 * the task-1.2 GET spike, so importing it resolves but does NOT satisfy the
 * asserted contract; `summon/route.ts` does not exist yet, so importing it
 * rejects. Either way the suite is red until task 27.2.
 */
const ROUTES: readonly { readonly name: string; readonly load: () => Promise<RouteModule> }[] = [
  { name: "summon", load: () => import("./summon/route.js") as Promise<RouteModule> },
  { name: "readings", load: () => import("./readings/route.js") as Promise<RouteModule> },
];

for (const route of ROUTES) {
  describe(`app/api/${route.name}/route.ts — route config and method guards (R6.11, R12.2)`, () => {
    it('exports runtime = "nodejs" (Node runtime, not Edge — R6.11)', async () => {
      const mod = await route.load();
      expect(mod.runtime).toBe("nodejs");
    });

    it('exports dynamic = "force-dynamic" (never statically cached)', async () => {
      const mod = await route.load();
      expect(mod.dynamic).toBe("force-dynamic");
    });

    it("exports maxDuration = 50 (serverless backstop above the 40 s budget — R6.11)", async () => {
      const mod = await route.load();
      expect(mod.maxDuration).toBe(50);
    });

    it("wires POST to a handler function (happy path lives in the handler tests)", async () => {
      const mod = await route.load();
      expect(typeof mod.POST).toBe("function");
    });

    for (const method of NON_POST_METHODS) {
      it(`${method} returns 405 with Allow: POST and no-store (R12.2)`, async () => {
        const mod = await route.load();
        const handler = mod[method as NonPostMethod];
        expect(typeof handler).toBe("function");

        const req = new Request(`https://necro.test/api/${route.name}`, { method });
        const res = await (handler as (req: Request) => Promise<Response> | Response)(req);

        expect(res.status).toBe(405);
        expect(res.headers.get("allow")).toBe("POST");
        expect(res.headers.get("cache-control")).toBe("no-store");
        expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      });
    }

    it("non-POST (except HEAD) carries a VALIDATION_FAILED Error_Envelope body (R12.2)", async () => {
      const mod = await route.load();
      // GET is representative of every non-HEAD method; they all share the
      // single `methodNotAllowed` guard.
      const handler = mod.GET as (req: Request) => Promise<Response> | Response;
      const res = await handler(
        new Request(`https://necro.test/api/${route.name}`, { method: "GET" }),
      );

      expect(res.status).toBe(405);
      const body = (await res.json()) as { error?: { code?: string; userMessage?: string } };
      expect(body.error?.code).toBe("VALIDATION_FAILED");
      expect(typeof body.error?.userMessage).toBe("string");
      expect((body.error?.userMessage ?? "").length).toBeGreaterThan(0);
    });

    it("HEAD returns 405 with the 405 headers but NO body (RFC 9110)", async () => {
      const mod = await route.load();
      const handler = mod.HEAD as (req: Request) => Promise<Response> | Response;
      const res = await handler(
        new Request(`https://necro.test/api/${route.name}`, { method: "HEAD" }),
      );

      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
      expect(res.headers.get("cache-control")).toBe("no-store");
      const text = await res.text();
      expect(text).toBe("");
    });
  });
}
