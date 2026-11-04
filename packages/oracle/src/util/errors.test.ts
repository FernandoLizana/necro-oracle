/**
 * Unit tests for `NecroError` (task 2.2).
 *
 * Asserts that every NecroError carries a machine-readable `code`, an
 * oracle-voice `userMessage`, an optional `cause`, has `name === "NecroError"`,
 * and that the standard `Error.message` equals the `userMessage`.
 *
 * Validates: Requirements R1.3
 */
import { describe, expect, it } from "vitest";
import { NecroError, NecroErrorCodeSchema } from "./errors.js";

describe("R1.3: NecroError", () => {
  it("sets code, userMessage, and cause from the constructor", () => {
    const cause = new Error("underlying failure");
    const err = new NecroError(
      "REGISTRY_INVALID",
      "The deck is malformed; card 'judgement' fails its ward.",
      cause,
    );

    expect(err.code).toBe("REGISTRY_INVALID");
    expect(err.userMessage).toBe(
      "The deck is malformed; card 'judgement' fails its ward.",
    );
    expect(err.cause).toBe(cause);
  });

  it('has name === "NecroError"', () => {
    const err = new NecroError("CARD_NOT_FOUND", "No such card walks the deck.");
    expect(err.name).toBe("NecroError");
  });

  it("sets message equal to userMessage", () => {
    const userMessage = "The parser's heart would not start.";
    const err = new NecroError("PARSER_INIT_FAILED", userMessage);
    expect(err.message).toBe(userMessage);
    expect(err.message).toBe(err.userMessage);
  });

  it("is an instance of Error and NecroError", () => {
    const err = new NecroError("DETECTOR_FAILED", "A seer faltered.");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(NecroError);
  });

  it("leaves cause undefined when omitted", () => {
    const err = new NecroError("FILE_TOO_LARGE", "This corpse is too heavy to read.");
    expect(err.cause).toBeUndefined();
  });

  it("accepts every registered error code and preserves its fields", () => {
    for (const code of NecroErrorCodeSchema.options) {
      const userMessage = `A dark omen: ${code}.`;
      const err = new NecroError(code, userMessage);
      expect(err.code).toBe(code);
      expect(err.userMessage).toBe(userMessage);
      expect(err.message).toBe(userMessage);
      expect(err.name).toBe("NecroError");
    }
  });
});
