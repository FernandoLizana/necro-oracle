// apps/web/src/server/client-ip.test.ts
//
// Examples for the client-IP hashing helper (design "Handler pipeline" step 1):
//
//   clientIp(req: Request, env: RouteEnvPort): string
//
// `clientIp` reads the configured header name from the env port
// (`NECRO_CLIENT_IP_HEADER`, default `x-real-ip`), validates the header value
// as an IPv4 or IPv6 literal, and returns a stable 32-char hex id computed as
// `sha256(ip).slice(0, 32)`. When the header is absent or is not a valid IP
// literal it hashes the fixed string "anonymous" instead. The RAW IP is never
// returned — only the truncated hash — to honour the privacy rule (R13.9).
//
// The helper lives in `apps/web/src/server/client-ip.ts` (NOT yet written —
// task 20.2). This test is written first and is EXPECTED TO FAIL for the
// "missing module ./client-ip.js" reason until 20.2 implements it (red, then
// green).
//
// Assumed function shape (recorded for task 20.2):
//   export function clientIp(req: Request, env: RouteEnvPort): string
//   - returns the 32-char lowercase hex id `sha256(ip).slice(0, 32)`
//   - hashes the validated IP literal, or the literal "anonymous" when the
//     configured header is missing or does not parse as IPv4/IPv6
//   - reads the header name via env.get("NECRO_CLIENT_IP_HEADER")
//
// _Requirements: R5.3, R6.1, R6.4, R13.9_

import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { clientIp } from "./client-ip.js";

// --- test doubles ----------------------------------------------------------

/** Minimal RouteEnvPort stub: only `get` is exercised by `clientIp`. */
function envWithHeader(headerName: string | undefined): { get(key: string): string | undefined } {
  return {
    get(key: string): string | undefined {
      if (key === "NECRO_CLIENT_IP_HEADER") return headerName;
      return undefined;
    },
  };
}

/** Default env: the configured header falls back to `x-real-ip`. */
const defaultEnv = envWithHeader("x-real-ip");

/** A Request carrying the given headers. */
function reqWith(headers: Record<string, string>): Request {
  return new Request("https://necro.example/api/readings", {
    method: "POST",
    headers,
  });
}

/** The expected id for a given literal: sha256 hex truncated to 32 chars. */
function expectedId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

const ANON_ID = expectedId("anonymous");
const HEX32 = /^[0-9a-f]{32}$/;

// --- examples --------------------------------------------------------------

describe("clientIp: reads the configured header", () => {
  it("defaults to the x-real-ip header when NECRO_CLIENT_IP_HEADER is unset", () => {
    const ipv4 = "203.0.113.7";
    const id = clientIp(reqWith({ "x-real-ip": ipv4 }), envWithHeader(undefined));

    expect(id).toBe(expectedId(ipv4));
    expect(id).toMatch(HEX32);
  });

  it("reads a custom header name when one is configured", () => {
    const ipv4 = "198.51.100.42";
    const id = clientIp(reqWith({ "cf-connecting-ip": ipv4 }), envWithHeader("cf-connecting-ip"));

    expect(id).toBe(expectedId(ipv4));
  });

  it("ignores the default header when a different one is configured", () => {
    // Value lives under x-real-ip, but the configured header is cf-connecting-ip
    // (absent), so the IP is treated as missing → anonymous.
    const id = clientIp(reqWith({ "x-real-ip": "203.0.113.7" }), envWithHeader("cf-connecting-ip"));

    expect(id).toBe(ANON_ID);
  });
});

describe("clientIp: validates IPv4/IPv6 literals and hashes them", () => {
  it("hashes a valid IPv4 literal to sha256(ip).slice(0,32)", () => {
    const ipv4 = "192.0.2.123";
    const id = clientIp(reqWith({ "x-real-ip": ipv4 }), defaultEnv);

    expect(id).toBe(expectedId(ipv4));
    expect(id).toMatch(HEX32);
    expect(id).not.toContain(ipv4); // the raw IP is never returned (R13.9)
  });

  it("hashes a valid full IPv6 literal to sha256(ip).slice(0,32)", () => {
    const ipv6 = "2001:0db8:85a3:0000:0000:8a2e:0370:7334";
    const id = clientIp(reqWith({ "x-real-ip": ipv6 }), defaultEnv);

    expect(id).toBe(expectedId(ipv6));
    expect(id).toMatch(HEX32);
    expect(id).not.toContain(ipv6);
  });

  it("hashes a compressed IPv6 literal", () => {
    const ipv6 = "2001:db8::8a2e:370:7334";
    const id = clientIp(reqWith({ "x-real-ip": ipv6 }), defaultEnv);

    expect(id).toBe(expectedId(ipv6));
    expect(id).toMatch(HEX32);
  });

  it("hashes the IPv6 loopback literal", () => {
    const ipv6 = "::1";
    const id = clientIp(reqWith({ "x-real-ip": ipv6 }), defaultEnv);

    expect(id).toBe(expectedId(ipv6));
  });
});

describe("clientIp: missing or invalid IP yields the anonymous id", () => {
  it("returns the anonymous id when the configured header is absent", () => {
    const id = clientIp(reqWith({}), defaultEnv);

    expect(id).toBe(ANON_ID);
    expect(id).toMatch(HEX32);
  });

  it("returns the anonymous id when the header value is not an IP literal", () => {
    const id = clientIp(reqWith({ "x-real-ip": "not-an-ip" }), defaultEnv);

    expect(id).toBe(ANON_ID);
  });

  it("returns the anonymous id when the header value is empty", () => {
    const id = clientIp(reqWith({ "x-real-ip": "" }), defaultEnv);

    expect(id).toBe(ANON_ID);
  });

  it("rejects an out-of-range IPv4 octet as invalid", () => {
    const id = clientIp(reqWith({ "x-real-ip": "999.0.0.1" }), defaultEnv);

    expect(id).toBe(ANON_ID);
  });

  it("rejects an IPv4 with a port suffix as invalid (literal only)", () => {
    const id = clientIp(reqWith({ "x-real-ip": "203.0.113.7:8080" }), defaultEnv);

    expect(id).toBe(ANON_ID);
  });

  it("never returns the raw IP even when the value is invalid", () => {
    const raw = "203.0.113.7:8080";
    const id = clientIp(reqWith({ "x-real-ip": raw }), defaultEnv);

    expect(id).not.toContain("203.0.113.7");
    expect(id).toMatch(HEX32);
  });
});
