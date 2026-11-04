// Task 11.1: failing unit tests for src/errors.ts (implemented in 11.3).
// Requirements: R6.5, R7.1, R7.10, R7.11.
// Contract assumed for 11.3:
//   summonerError(code, ctx, cause?) with a flat ctx:
//     { owner?, name?, ref?, minutes?, limit?, reason?, service?, httpStatus?, what?, where?, secrets? }
//   redactSecrets(text, secrets?) and sanitizeCause(error, secrets?) exported from ./errors.js.
import { NecroError } from "@necro/oracle";
import { describe, expect, it } from "vitest";
import {
  redactSecrets,
  sanitizeCause,
  SummonerError,
  summonerError,
  type SummonerErrorCode,
} from "./errors.js";

const REPO = { owner: "octo", name: "grave" };

/** One valid context per code, plus the catalog text from the design table. */
const CATALOG: ReadonlyArray<{
  code: SummonerErrorCode;
  ctx: Parameters<typeof summonerError>[1];
  mystical: string;
  technical: string;
}> = [
  {
    code: "INVALID_REPO_URL",
    ctx: { reason: "missing-name" },
    mystical: "The sigil is malformed. The oracle cannot trace it.",
    technical:
      "Expected owner/repo or https://github.com/owner/repo. Rejected: missing-name.",
  },
  {
    code: "REPO_NOT_FOUND",
    ctx: REPO,
    mystical: "No grave lies at this address.",
    technical:
      "GitHub shows no repository octo/grave visible to this token. Check the spelling, or the repository moved or was renamed.",
  },
  {
    code: "REPO_PRIVATE",
    ctx: REPO,
    mystical: "A sealed crypt. The oracle reads only open graves.",
    technical:
      "octo/grave is private or cannot be shown to be public. Only public repositories are supported.",
  },
  {
    code: "RATE_LIMITED",
    ctx: { minutes: 4 },
    mystical: "The spirits are silent. GitHub bars the door.",
    technical: "GitHub API rate limit reached. Retry in 4 min.",
  },
  {
    code: "NETWORK_TIMEOUT",
    ctx: { service: "GitHub API" },
    mystical: "The ether does not answer.",
    technical:
      "GitHub API did not respond in time or was unreachable. Retry shortly.",
  },
  {
    code: "DOWNLOAD_TOO_LARGE",
    ctx: { limit: "compressed" },
    mystical: "This crypt is too vast to enter.",
    technical:
      "The archive exceeded the compressed 50 MB limit. Try a smaller repository.",
  },
  {
    code: "VALIDATION_FAILED",
    ctx: { what: "Repository metadata", where: "GitHub API" },
    mystical: "The spirits spoke in a tongue the oracle does not know.",
    technical:
      "Repository metadata failed validation (GitHub API). Retry; report it if it persists.",
  },
  {
    code: "REF_NOT_FOUND",
    ctx: { ...REPO, ref: "v9.9.9" },
    mystical: "The name you speak is not written in this grave.",
    technical:
      'Ref "v9.9.9" does not exist in octo/grave. Check the branch, tag, or commit SHA, or omit the ref to read the default branch.',
  },
  {
    code: "AUTH_INVALID",
    ctx: {},
    mystical: "The key is refused. The gate stays shut.",
    technical:
      "GitHub rejected the credentials in GITHUB_TOKEN. Replace the token or unset it to read public repositories without one.",
  },
  {
    code: "UPSTREAM_UNAVAILABLE",
    ctx: { service: "GitHub archive", httpStatus: 503 },
    mystical: "The halls of GitHub are dark tonight.",
    technical:
      "GitHub archive answered with a server error (HTTP 503). This is not your repository; retry in a few minutes.",
  },
];

describe("summonerError (R7.1, R7.10)", () => {
  it.each(CATALOG)(
    "$code builds a SummonerError that is also a NecroError",
    ({ code, ctx }) => {
      const err = summonerError(code, ctx);
      expect(err).toBeInstanceOf(SummonerError);
      expect(err).toBeInstanceOf(NecroError);
      expect(err).toBeInstanceOf(Error);
      expect(err.code).toBe(code);
      expect(err.userMessage).toBe(err.message);
    },
  );

  it.each(CATALOG)(
    "$code message matches the design catalog",
    ({ code, ctx, mystical, technical }) => {
      const err = summonerError(code, ctx);
      expect(err.userMessage).toBe(`${mystical}\n${technical}`);
    },
  );

  it.each(CATALOG)(
    "$code message is ASCII, one line break, mystical line <= 16 words",
    ({ code, ctx }) => {
      const { userMessage } = summonerError(code, ctx);
      expect(userMessage).toMatch(/^[\x20-\x7E\n]+$/);
      const lines = userMessage.split("\n");
      expect(lines).toHaveLength(2);
      expect(lines[0]!.trim().split(/\s+/).length).toBeLessThanOrEqual(16);
      expect(lines[1]!.trim().length).toBeGreaterThan(0);
    },
  );

  it("exposes only non-secret scalars in details", () => {
    const err = summonerError("UPSTREAM_UNAVAILABLE", {
      service: "GitHub API",
      httpStatus: 502,
    });
    expect(err.details.httpStatus).toBe(502);
    const rate = summonerError("RATE_LIMITED", { minutes: 7 });
    expect(rate.details.retryAfterMinutes).toBe(7);
    const big = summonerError("DOWNLOAD_TOO_LARGE", { limit: "entries" });
    expect(big.details.limit).toBe("entries");
    const ref = summonerError("REF_NOT_FOUND", { ...REPO, ref: "dev" });
    expect(ref.details.ref).toBe("dev");
  });

  it("REF_NOT_FOUND names the ref (R7.7)", () => {
    const { userMessage } = summonerError("REF_NOT_FOUND", {
      ...REPO,
      ref: "feature/x",
    });
    expect(userMessage).toContain('Ref "feature/x"');
  });

  it("REF_NOT_FOUND masks a token-shaped ref", () => {
    const ref = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
    const err = summonerError("REF_NOT_FOUND", { ...REPO, ref });
    expect(err.userMessage).not.toContain(ref);
    expect(err.userMessage).toContain("[REDACTED]");
    expect(err.details.ref).not.toContain(ref);
  });

  it("RATE_LIMITED states whole minutes, at least 1", () => {
    expect(summonerError("RATE_LIMITED", { minutes: 12 }).userMessage).toContain(
      "Retry in 12 min.",
    );
    expect(summonerError("RATE_LIMITED", { minutes: 0 }).userMessage).toContain(
      "Retry in 1 min.",
    );
    const frac = summonerError("RATE_LIMITED", { minutes: 2.3 });
    expect(frac.userMessage).toMatch(/Retry in \d+ min\./);
    expect(frac.userMessage).not.toMatch(/\d\.\d/);
  });

  it("AUTH_INVALID names GITHUB_TOKEN and never a value (R6.5)", () => {
    const secret = "ghp_supersecretvalue1234567890abcdefghij";
    const err = summonerError(
      "AUTH_INVALID",
      { secrets: [secret] },
      new Error(`401 with Authorization: Bearer ${secret}`),
    );
    expect(err.userMessage).toContain("GITHUB_TOKEN");
    expect(err.userMessage).not.toContain(secret);
    expect(JSON.stringify(err.details)).not.toContain(secret);
    expect(String((err.cause as Error).message)).not.toContain(secret);
    expect(String((err.cause as Error).stack ?? "")).not.toContain(secret);
  });
});

describe("redactSecrets (R6.5)", () => {
  it("replaces every occurrence of each known secret", () => {
    const out = redactSecrets("a s3cret b s3cret c other-key d", [
      "s3cret",
      "other-key",
    ]);
    expect(out).toBe("a [REDACTED] b [REDACTED] c [REDACTED] d");
  });

  it("ignores empty known secrets", () => {
    expect(redactSecrets("plain text", [""])).toBe("plain text");
  });

  it("masks Bearer credentials", () => {
    const out = redactSecrets("Authorization: Bearer abc.DEF-123_xyz== end");
    expect(out).not.toContain("abc.DEF-123_xyz");
    expect(out).toContain("[REDACTED]");
    expect(out).toContain("end");
  });

  it.each(["ghp_", "gho_", "ghu_", "ghs_", "ghr_", "github_pat_"])(
    "masks %s-prefixed tokens",
    (prefix) => {
      const token = `${prefix}AbC123xyz890AbC123xyz890`;
      const out = redactSecrets(`leak ${token} here`);
      expect(out).not.toContain(token);
      expect(out).not.toContain(`${prefix}AbC`);
      expect(out).toBe("leak [REDACTED] here");
    },
  );

  it("leaves text without secrets unchanged", () => {
    const text = "GitHub API rate limit reached. Retry in 4 min.";
    expect(redactSecrets(text, ["zzz-not-present"])).toBe(text);
  });
});

describe("sanitized cause (R6.5, R7.11)", () => {
  it("keeps name, code, status and redacts message and stack", () => {
    const secret = "tok-0123456789";
    const original = Object.assign(
      new TypeError(`request failed, header Authorization: Bearer ${secret}`),
      { code: "ECONNRESET", status: 502, headers: { authorization: secret } },
    );
    original.stack = `TypeError: leak ${secret}\n    at fn (file.ts:1:1)`;

    const clean = sanitizeCause(original, [secret]) as Error & {
      code?: string;
      status?: number;
    };

    expect(clean).not.toBe(original);
    expect(clean).toBeInstanceOf(Error);
    expect(clean.name).toBe("TypeError");
    expect(clean.code).toBe("ECONNRESET");
    expect(clean.status).toBe(502);
    expect(clean.message).not.toContain(secret);
    expect(clean.message).toContain("[REDACTED]");
    expect(clean.stack ?? "").not.toContain(secret);
    expect(JSON.stringify(Object.entries(clean))).not.toContain(secret);
    expect("headers" in clean).toBe(false);
  });

  it("wraps non-Error causes into a redacted Error", () => {
    const clean = sanitizeCause("boom ghs_abcdefghijklmnopqrstuv") as Error;
    expect(clean).toBeInstanceOf(Error);
    expect(clean.message).not.toContain("ghs_abcdef");
  });

  it("summonerError attaches the sanitized clone, not the original", () => {
    const original = new Error("fail Bearer topsecret");
    const err = summonerError("NETWORK_TIMEOUT", { service: "GitHub API" }, original);
    expect(err.cause).toBeInstanceOf(Error);
    expect(err.cause).not.toBe(original);
    expect((err.cause as Error).message).not.toContain("topsecret");
  });

  it("omits cause when none is given", () => {
    expect(summonerError("REPO_PRIVATE", REPO).cause).toBeUndefined();
  });
});

describe("repository content is never redacted (design: Redaction)", () => {
  it("userMessage and details carry no repo file text, and redaction is not applied to arbitrary file content by the module", () => {
    // Repository content looks like a token on purpose. The module exposes
    // redactSecrets only for errors; callers must not route file contents through it.
    // The factory has no field that accepts file contents.
    const err = summonerError("VALIDATION_FAILED", {
      what: "Archive",
      where: "tarball",
    });
    expect(Object.keys(err.details)).not.toContain("content");
    expect(err.userMessage).toBe(
      "The spirits spoke in a tongue the oracle does not know.\nArchive failed validation (tarball). Retry; report it if it persists.",
    );
  });
});
