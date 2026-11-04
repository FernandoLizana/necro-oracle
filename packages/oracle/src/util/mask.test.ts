/**
 * Unit tests for `maskSecret` (task 5.1, test-first).
 *
 * `maskSecret(value: string): string` is documented in design.md as:
 *   value.length >= 4 → value.slice(0, 4) + "****"
 *   value.length <  4 → "****"
 *
 * These tests are written BEFORE the real implementation (task 5.2). Until the
 * body is implemented they are EXPECTED TO BE RED. The implementation currently
 * ships as a throwing stub so the package keeps typechecking.
 *
 * Validates: Requirements R20.1, R20.4
 */
import { describe, expect, it } from "vitest";
import { maskSecret } from "./mask.js";

describe("R20.1, R20.4: maskSecret", () => {
  it("keeps the first 4 characters and appends '****' when length >= 4", () => {
    expect(maskSecret("abcd")).toBe("abcd****");
    expect(maskSecret("abcdef")).toBe("abcd****");
    expect(maskSecret("password123")).toBe("pass****");
  });

  it("returns exactly 8 characters for any input of length >= 4", () => {
    expect(maskSecret("abcd")).toHaveLength(8);
    expect(maskSecret("a-very-long-secret-value")).toHaveLength(8);
  });

  it("returns '****' when the value has fewer than 4 characters (R20.4)", () => {
    expect(maskSecret("")).toBe("****");
    expect(maskSecret("a")).toBe("****");
    expect(maskSecret("ab")).toBe("****");
    expect(maskSecret("abc")).toBe("****");
  });

  it("treats length exactly 4 as the >= 4 branch", () => {
    // Boundary: 4 chars preserved, not collapsed to "****".
    expect(maskSecret("wxyz")).toBe("wxyz****");
  });

  it("reduces an AWS access key id so the raw value does not survive", () => {
    const awsKey = "AKIAIOSFODNN7EXAMPLE";
    const masked = maskSecret(awsKey);

    expect(masked).toBe("AKIA****");
    expect(masked).toHaveLength(8);
    // The raw secret must not survive the masking call.
    expect(masked).not.toBe(awsKey);
    expect(masked.length).toBeLessThan(awsKey.length);
    // Full AWS key id pattern must not appear in the output.
    expect(masked).not.toMatch(/AKIA[0-9A-Z]{16}/);
  });

  it("reduces a private-key header so the raw value does not survive", () => {
    const privateKeyHeader = "-----BEGIN RSA PRIVATE KEY-----";
    const masked = maskSecret(privateKeyHeader);

    expect(masked).toBe("----****");
    expect(masked).toHaveLength(8);
    expect(masked).not.toBe(privateKeyHeader);
    expect(masked).not.toContain("BEGIN RSA PRIVATE KEY");
  });

  it("reduces a PKCS#8 private-key header so the raw value does not survive", () => {
    const privateKeyHeader = "-----BEGIN PRIVATE KEY-----";
    const masked = maskSecret(privateKeyHeader);

    expect(masked).toBe("----****");
    expect(masked).not.toContain("BEGIN PRIVATE KEY");
  });
});
