// FetchTransportError contract (task 8.1). Requirements: R9.5 (transport failure is not a NecroError).
import { describe, expect, it } from "vitest";
import { NecroError } from "@necro/oracle";
import { FetchTransportError } from "./ports.js";

describe("FetchTransportError", () => {
  it("carries kind, message and cause", () => {
    const cause = new Error("socket hang up");
    const err = new FetchTransportError("network", "boom", cause);
    expect(err).toBeInstanceOf(Error);
    expect(err.kind).toBe("network");
    expect(err.message).toBe("boom");
    expect(err.cause).toBe(cause);
  });

  it("supports the timeout kind and an absent cause", () => {
    const err = new FetchTransportError("timeout", "slow");
    expect(err.kind).toBe("timeout");
    expect(err.cause).toBeUndefined();
  });

  it("is not a NecroError", () => {
    const err = new FetchTransportError("timeout", "slow");
    expect(err).toBeInstanceOf(FetchTransportError);
    expect(err).not.toBeInstanceOf(NecroError);
  });
});
