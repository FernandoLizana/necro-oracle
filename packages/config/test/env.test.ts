import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/index.js";

function thrownMessage(source: Record<string, string | undefined>): string {
  try {
    loadEnv(source);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error("expected loadEnv to throw");
}

describe("loadEnv GITHUB_TOKEN (R6.1, R6.5)", () => {
  it.each([
    ["missing", {}],
    ["undefined", { GITHUB_TOKEN: undefined }],
    ["empty", { GITHUB_TOKEN: "" }],
    ["spaces only", { GITHUB_TOKEN: "   " }],
    ["tabs and newlines only", { GITHUB_TOKEN: " \t\r\n " }],
  ])("treats a %s token as unset", (_label, source) => {
    const env = loadEnv(source);
    expect(env.GITHUB_TOKEN).toBeUndefined();
  });

  it("accepts a valid token unchanged", () => {
    const token = "ghp_AbC123xyz_0987654321";
    expect(loadEnv({ GITHUB_TOKEN: token }).GITHUB_TOKEN).toBe(token);
  });

  it.each([
    ["inner space", "ghp_SECRET value"],
    ["inner tab", "ghp_SECRET\tvalue"],
    ["inner newline", "ghp_SECRET\nvalue"],
    ["bell control char", "ghp_SECRET\u0007value"],
    ["NUL control char", "ghp_SECRET\u0000value"],
    ["DEL control char", "ghp_SECRET\u007fvalue"],
  ])("rejects a token with %s, naming the key only", (_label, token) => {
    expect(() => loadEnv({ GITHUB_TOKEN: token })).toThrow();
    const message = thrownMessage({ GITHUB_TOKEN: token });
    expect(message).toContain("GITHUB_TOKEN");
    expect(message).not.toContain(token);
    expect(message).not.toContain("ghp_SECRET");
  });
});
