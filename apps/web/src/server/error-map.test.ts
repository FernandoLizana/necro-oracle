// apps/web/src/server/error-map.test.ts
//
// Example tests for the server error mapper (task 21.1, TEST-FIRST).
//
// TEST-FIRST (red). Written before `server/error-map.ts` (task 21.2); the
// import below fails to resolve until it exists (red, then green).
//
// These examples pin the exact contract from design.md §"Error mapper":
//   - the full statusFor table (one example per branch),
//   - mapError over a NecroError: status, { error: { code, userMessage } },
//     no `cause` serialised (R12.7), userMessage redacted with the token,
//   - mapError over a non-NecroError: 500 + UPSTREAM_UNAVAILABLE + fixed
//     message, no exception text (R12.5),
//   - a summoner RATE_LIMITED exposes Retry-After = retryAfterMinutes * 60,
//   - rateLimitedError arithmetic (minutes = max(1, ceil(sec/60))).
//
// _Requirements: R12.4, R12.5, R12.6, R12.7_
import { NecroError } from "@necro/oracle/client";
import { describe, expect, it } from "vitest";

// Not yet implemented — task 21.2 adds this module.
import { mapError, rateLimitedError, statusFor } from "./error-map.js";

describe("statusFor — the full code -> status table", () => {
  it("maps each code to its documented status (R12.4, Q2, Q10)", () => {
    expect(statusFor("INVALID_REPO_URL")).toBe(400);
    expect(statusFor("VALIDATION_FAILED")).toBe(400);
    expect(statusFor("REPO_PRIVATE")).toBe(403);
    expect(statusFor("REPO_NOT_FOUND")).toBe(404);
    expect(statusFor("REF_NOT_FOUND")).toBe(404);
    expect(statusFor("DOWNLOAD_TOO_LARGE")).toBe(413);
    expect(statusFor("RATE_LIMITED")).toBe(429);
    expect(statusFor("AUTH_INVALID")).toBe(502);
    expect(statusFor("UPSTREAM_UNAVAILABLE")).toBe(502);
    expect(statusFor("NETWORK_TIMEOUT")).toBe(504);
  });

  it("maps every other known code to 500", () => {
    for (const code of [
      "REGISTRY_INVALID",
      "CARD_NOT_FOUND",
      "PARSER_INIT_FAILED",
      "FILE_TOO_LARGE",
      "INVALID_QUERY_PATTERN",
      "SNAPSHOT_DIR_NOT_FOUND",
      "INVALID_REPO_META",
      "DETECTOR_FAILED",
    ] as const) {
      expect(statusFor(code)).toBe(500);
    }
  });
});

describe("mapError — NecroError branch", () => {
  it("returns the status, a { error: { code, userMessage } } body and no cause", () => {
    const err = new NecroError(
      "VALIDATION_FAILED",
      "The sigil is malformed.",
      new Error("inner stack"),
    );
    const mapped = mapError(err);
    expect(mapped.status).toBe(400);
    expect(mapped.body).toEqual({
      error: { code: "VALIDATION_FAILED", userMessage: "The sigil is malformed." },
    });
    // cause is never read nor serialised (R12.7).
    expect(JSON.stringify(mapped)).not.toContain("cause");
    expect(JSON.stringify(mapped)).not.toContain("inner stack");
  });

  it("redacts the token out of userMessage before returning it (R12.6)", () => {
    const token = "ghp_secretTOKENvalue";
    const err = new NecroError(
      "UPSTREAM_UNAVAILABLE",
      `The veil tore open: ${token} refused.`,
    );
    const mapped = mapError(err, token);
    expect(mapped.body.error.userMessage).not.toContain(token);
    expect(mapped.body.error.userMessage).toContain("[REDACTED]");
  });

  it("sets Retry-After from retryAfterMinutes * 60 for a summoner RATE_LIMITED", () => {
    // A summoner may expose details.retryAfterMinutes on a RATE_LIMITED error.
    const err = Object.assign(
      new NecroError("RATE_LIMITED", "The oracle must rest."),
      { details: { retryAfterMinutes: 3 } },
    );
    const mapped = mapError(err);
    expect(mapped.status).toBe(429);
    expect(mapped.headers["Retry-After"]).toBe("180");
  });
});

describe("mapError — non-NecroError branch", () => {
  it("maps a thrown string to 500 + UPSTREAM_UNAVAILABLE with a fixed message and no leak", () => {
    const mapped = mapError("boom: internal detail xyz");
    expect(mapped.status).toBe(500);
    expect(mapped.body.error.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(mapped.body.error.userMessage.length).toBeGreaterThan(0);
    expect(JSON.stringify(mapped)).not.toContain("internal detail xyz");
  });

  it("maps a thrown Error without leaking its message or stack (R12.5, R12.7)", () => {
    const mapped = mapError(new Error("database password=hunter2"));
    expect(mapped.status).toBe(500);
    expect(mapped.body.error.code).toBe("UPSTREAM_UNAVAILABLE");
    const serialised = JSON.stringify(mapped);
    expect(serialised).not.toContain("hunter2");
    expect(serialised).not.toContain("cause");
    expect(serialised).not.toContain("stack");
  });
});

describe("rateLimitedError — Retry-After arithmetic", () => {
  it("builds a RATE_LIMITED NecroError with minutes = max(1, ceil(sec/60))", () => {
    expect(rateLimitedError(0).userMessage).toBe(
      "The oracle must rest.\nToo many readings from this address. Retry in 1 min.",
    );
    expect(rateLimitedError(60).userMessage).toBe(
      "The oracle must rest.\nToo many readings from this address. Retry in 1 min.",
    );
    expect(rateLimitedError(61).userMessage).toBe(
      "The oracle must rest.\nToo many readings from this address. Retry in 2 min.",
    );
    expect(rateLimitedError(600).code).toBe("RATE_LIMITED");
  });
});
