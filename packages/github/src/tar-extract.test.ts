/**
 * Unit tests for `tar-extract.ts` (spec 02-github-summoner, task 21.1; test-first, they fail
 * until task 21.5 lands the implementation).
 * Validates R3.2, R3.3, R3.4, R3.5, R3.6, R3.9, R3.10, R3.11, R3.13, R4.6.
 *
 * ASSUMED API (design: "Tarball extraction"; task 21.5 must match or update this header)
 *
 *   export interface ExtractionLimits { maxCompressedBytes; maxUncompressedBytes; maxEntries }
 *   export const DEFAULT_LIMITS: ExtractionLimits;   // 52_428_800 / 209_715_200 / 100_000
 *   export interface ExtractedTree {
 *     files: Record<string, string>;                 // null prototype
 *     hasWorkflowsDir: boolean;
 *     stats: { entries, skippedTraversal, skippedLinks, skippedSpecial,
 *              skippedVendored, skippedBinary, oversize };
 *   }
 *   export function extractTarball(
 *     body: ReadableStream<Uint8Array>,
 *     limits?: Partial<ExtractionLimits>,
 *     options?: { contentLength?: number | null },   // ASSUMPTION: the design says a
 *   ): Promise<ExtractedTree>;                       // Content-Length above the compressed cap fails
 *                                                    // before the first byte is read; this optional
 *                                                    // third parameter carries that header.
 *
 * Conventions assumed:
 * - `stats.entries` counts every entry that reaches the handler (including the root directory
 *   entry); the pax global header is resolved internally by tar-stream and is not counted.
 * - The oversize sentinel is one shared string of TEXT_FILE_CEILING_BYTES + 1 characters.
 * - Cap violations reject with SummonerError DOWNLOAD_TOO_LARGE and details.limit of
 *   "compressed" | "uncompressed" | "entries"; corrupt archives reject with VALIDATION_FAILED.
 * - The upstream body is cancelled on every failure.
 */
import { randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { TEXT_FILE_CEILING_BYTES } from "./constants.js";
import { SummonerError } from "./errors.js";
import { DEFAULT_LIMITS, extractTarball } from "./tar-extract.js";
import { lazyZeroFileTarGz, makeTarGz } from "./testing/make-tar-gz.js";
import { paxGlobalEntry, type RawTarEntry } from "./testing/raw-tar.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const PREFIX = `owner-repo-${SHA}/`;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface TrackedBody {
  readonly body: ReadableStream<Uint8Array>;
  readonly state: { pulls: number; cancels: number };
}

/** Chunked web stream over `bytes` that records pulls and cancellation. */
function trackedBody(bytes: Uint8Array, chunkSize = 4096): TrackedBody {
  const state = { pulls: 0, cancels: 0 };
  let at = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        state.pulls++;
        if (at >= bytes.length) return controller.close();
        controller.enqueue(bytes.subarray(at, at + chunkSize));
        at += chunkSize;
      },
      cancel() {
        state.cancels++;
      },
    },
    { highWaterMark: 0 },
  );
  return { body, state };
}

const bodyOf = (bytes: Uint8Array): ReadableStream<Uint8Array> => trackedBody(bytes).body;

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new Error("expected extractTarball to reject");
}

async function expectSummoner(
  promise: Promise<unknown>,
  code: SummonerError["code"],
  limit?: "compressed" | "uncompressed" | "entries",
): Promise<SummonerError> {
  const err = await rejection(promise);
  expect(err).toBeInstanceOf(SummonerError);
  const se = err as SummonerError;
  expect(se.code).toBe(code);
  if (limit !== undefined) expect(se.details.limit).toBe(limit);
  return se;
}

const file = (path: string, body: Uint8Array | string = "x"): RawTarEntry => ({
  name: `${PREFIX}${path}`,
  body,
});
const BIG = { maxCompressedBytes: 1e9, maxUncompressedBytes: 1e9, maxEntries: 1e9 };

describe("DEFAULT_LIMITS (R3.9, R3.10, R3.11)", () => {
  it("pins the literal defaults", () => {
    expect(DEFAULT_LIMITS).toEqual({
      maxCompressedBytes: 52_428_800,
      maxUncompressedBytes: 209_715_200,
      maxEntries: 100_000,
    });
  });
});

describe("realistic GitHub layout (R3.2, R3.13)", () => {
  const entries: RawTarEntry[] = [
    paxGlobalEntry({ comment: SHA }),
    { name: PREFIX, typeflag: "5" },
    file("README.md", "# hello\n"),
    { name: `${PREFIX}src/`, typeflag: "5" },
    file("src/app.py", "print 1\n"),
    file("src/pkg/util.py", "x = 1\n"),
  ];

  it("yields repository-relative paths and contents, with a null-prototype map", async () => {
    const tree = await extractTarball(bodyOf(makeTarGz(entries)));
    expect(Object.getPrototypeOf(tree.files)).toBeNull();
    expect(Object.keys(tree.files).sort()).toEqual(["README.md", "src/app.py", "src/pkg/util.py"]);
    expect(tree.files["README.md"]).toBe("# hello\n");
    expect(tree.files["src/app.py"]).toBe("print 1\n");
    expect(tree.hasWorkflowsDir).toBe(false);
    expect(tree.stats.entries).toBe(5); // root dir, README, src/, app.py, util.py
  });

  it("drains a skipped entry and still reaches the entry after it", async () => {
    const tree = await extractTarball(
      bodyOf(
        makeTarGz([
          { name: `${PREFIX}link`, typeflag: "2", linkname: "/etc/passwd", body: "z".repeat(5000) },
          { name: `${PREFIX}vendor/big.js`, body: "v".repeat(70_000) },
          file("after.txt", "reached"),
        ]),
      ),
    );
    expect(Object.keys(tree.files)).toEqual(["after.txt"]);
    expect(tree.files["after.txt"]).toBe("reached");
  });

  it("decodes UTF-8 and preserves a BOM", async () => {
    const tree = await extractTarball(bodyOf(makeTarGz([file("u.txt", "\uFEFFcaf\u00e9")])));
    expect(tree.files["u.txt"]).toBe("\uFEFFcaf\u00e9");
  });

  it("a repeated path overwrites the earlier one", async () => {
    const tree = await extractTarball(
      bodyOf(makeTarGz([file("a.txt", "first"), file("a.txt", "second")])),
    );
    expect(tree.files["a.txt"]).toBe("second");
    expect(Object.keys(tree.files)).toEqual(["a.txt"]);
  });

  it("treats a file named __proto__ as an ordinary key", async () => {
    const tree = await extractTarball(bodyOf(makeTarGz([file("__proto__", "polluted?")])));
    expect(Object.keys(tree.files)).toEqual(["__proto__"]);
    expect(Object.getOwnPropertyDescriptor(tree.files, "__proto__")?.value).toBe("polluted?");
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(Object.getPrototypeOf(tree.files)).toBeNull();
  });
});

describe("hasWorkflowsDir (R4.6)", () => {
  it("is set by .github/workflows/ci.yml", async () => {
    const tree = await extractTarball(
      bodyOf(makeTarGz([file(".github/workflows/ci.yml", "on: push\n")])),
    );
    expect(tree.hasWorkflowsDir).toBe(true);
    expect(tree.files[".github/workflows/ci.yml"]).toBe("on: push\n");
  });

  it("is set by a bare workflows directory entry", async () => {
    const tree = await extractTarball(
      bodyOf(makeTarGz([{ name: `${PREFIX}.github/workflows/`, typeflag: "5" }])),
    );
    expect(tree.hasWorkflowsDir).toBe(true);
  });

  it("is set even when the workflow file is binary (checked before the filters)", async () => {
    const tree = await extractTarball(
      bodyOf(makeTarGz([file(".github/workflows/blob.bin", new Uint8Array([1, 0, 2]))])),
    );
    expect(tree.hasWorkflowsDir).toBe(true);
  });

  it("is false for .github without workflows and for nested workflows dirs", async () => {
    const tree = await extractTarball(
      bodyOf(makeTarGz([file(".github/CODEOWNERS", "* @a"), file("docs/.github/workflows/x.yml")])),
    );
    expect(tree.hasWorkflowsDir).toBe(false);
  });
});

describe("per-entry skip rules and stats (R3.3, R3.4, R3.5, R3.6)", () => {
  it("skips binary files by a NUL in the first 8000 bytes; a later NUL is kept", async () => {
    const lateNul = `${"a".repeat(8000)}\0tail`;
    const tree = await extractTarball(
      bodyOf(
        makeTarGz([
          file("bin.dat", new Uint8Array([104, 105, 0, 106])),
          file("late.txt", lateNul),
          file("ok.txt", "fine"),
        ]),
      ),
    );
    expect(Object.keys(tree.files).sort()).toEqual(["late.txt", "ok.txt"]);
    expect(tree.stats.skippedBinary).toBe(1);
  });

  it("skips vendored paths at any depth", async () => {
    const tree = await extractTarball(
      bodyOf(
        makeTarGz([
          file("node_modules/left-pad/index.js"),
          file("src/vendor/lib.py"),
          file(".git/config"),
          file("a/site-packages/x.py"),
          file("src/keep.py", "ok"),
        ]),
      ),
    );
    expect(Object.keys(tree.files)).toEqual(["src/keep.py"]);
    expect(tree.stats.skippedVendored).toBe(4);
  });

  it("skips symlinks, hard links, devices, FIFOs and traversal, with matching stats", async () => {
    const tree = await extractTarball(
      bodyOf(
        makeTarGz([
          { name: `${PREFIX}sym`, typeflag: "2", linkname: "../../etc/passwd" },
          { name: `${PREFIX}hard`, typeflag: "1", linkname: `${PREFIX}README.md` },
          { name: `${PREFIX}chr`, typeflag: "3" },
          { name: `${PREFIX}blk`, typeflag: "4" },
          { name: `${PREFIX}fifo`, typeflag: "6" },
          { name: "root/../../etc/passwd", body: "root:x" },
          { name: "/abs/path.txt", body: "abs" },
          { name: `${PREFIX}back\\..\\..\\win.txt`, body: "win" },
          file("README.md", "keep"),
        ]),
      ),
    );
    expect(Object.keys(tree.files)).toEqual(["README.md"]);
    expect(tree.stats).toMatchObject({
      skippedLinks: 2,
      skippedSpecial: 3,
      skippedTraversal: 3,
      skippedVendored: 0,
      skippedBinary: 0,
      oversize: 0,
    });
  });
});

describe("1 MiB boundary and the oversize sentinel (R3.7 groundwork, D4)", () => {
  it("keeps a file of exactly 1 MiB", async () => {
    const text = "a".repeat(TEXT_FILE_CEILING_BYTES);
    const tree = await extractTarball(bodyOf(makeTarGz([file("exact.txt", text)])));
    expect(tree.files["exact.txt"]).toBe(text);
    expect(tree.stats.oversize).toBe(0);
  });

  it("stores a 1 MiB + 1 text file as a shared sentinel of 1 MiB + 1 characters", async () => {
    const text = "b".repeat(TEXT_FILE_CEILING_BYTES + 1);
    const tree = await extractTarball(
      bodyOf(makeTarGz([file("big1.txt", text), file("big2.txt", "c".repeat(TEXT_FILE_CEILING_BYTES + 5))])),
    );
    expect(tree.files["big1.txt"]).toHaveLength(TEXT_FILE_CEILING_BYTES + 1);
    expect(tree.files["big1.txt"]).toBe(tree.files["big2.txt"]);
    expect(tree.stats.oversize).toBe(2);
  });
});

describe("guards count skipped-entry bytes upstream of tar-stream (P11, R3.9, R3.10, R3.11)", () => {
  const rand = (n: number): Uint8Array => {
    const b = new Uint8Array(randomBytes(n));
    b[0] = 0; // NUL: binary, hence skipped
    return b;
  };
  const randomText = (n: number): string =>
    randomBytes(Math.ceil((n * 3) / 4)).toString("base64").slice(0, n);

  /** All bulk lives in skipped entries; nothing is kept. */
  const skippedBulk = (payload: (n: number) => Uint8Array | string): RawTarEntry[] => [
    { name: "root/../../etc/shadow", body: payload(50_000) },
    { name: `${PREFIX}sym`, typeflag: "2", linkname: "/etc/passwd", body: payload(50_000) },
    { name: `${PREFIX}node_modules/x/index.js`, body: payload(50_000) },
    { name: `${PREFIX}blob.bin`, body: rand(50_000) },
    { name: `${PREFIX}huge.txt`, body: randomText(TEXT_FILE_CEILING_BYTES + 100) },
  ];

  it("control: the same archive extracts to an empty tree under generous limits", async () => {
    const tree = await extractTarball(bodyOf(makeTarGz(skippedBulk(rand))), BIG);
    // Only the shared oversize placeholder (design D4) survives; everything else is skipped.
    expect(Object.keys(tree.files)).toEqual(["huge.txt"]);
    expect(tree.stats.oversize).toBe(1);
  });

  it("the compressed cap fires on bytes that live only in skipped entries", async () => {
    const { body, state } = trackedBody(makeTarGz(skippedBulk(rand)));
    await expectSummoner(
      extractTarball(body, { ...BIG, maxCompressedBytes: 120_000 }),
      "DOWNLOAD_TOO_LARGE",
      "compressed",
    );
    await sleep(50);
    expect(state.cancels).toBeGreaterThanOrEqual(1);
  });

  it("the uncompressed cap fires on bytes that live only in skipped entries", async () => {
    const zeros = (n: number): Uint8Array => new Uint8Array(n);
    await expectSummoner(
      extractTarball(bodyOf(makeTarGz(skippedBulk(zeros))), { ...BIG, maxUncompressedBytes: 400_000 }),
      "DOWNLOAD_TOO_LARGE",
      "uncompressed",
    );
  });

  it("the uncompressed cap counts tar framing (1024 bytes per empty entry)", async () => {
    const entries = Array.from({ length: 40 }, (_, i) => file(`vendor/e${i}`, ""));
    await expectSummoner(
      extractTarball(bodyOf(makeTarGz(entries)), { ...BIG, maxUncompressedBytes: 20_000 }),
      "DOWNLOAD_TOO_LARGE",
      "uncompressed",
    );
  });

  it("the entry-count cap counts skipped entries", async () => {
    const entries = Array.from({ length: 30 }, (_, i) => file(`node_modules/p${i}/i.js`));
    const ok = await extractTarball(bodyOf(makeTarGz(entries)), { ...BIG, maxEntries: 30 });
    expect(ok.stats.entries).toBe(30);
    await expectSummoner(
      extractTarball(bodyOf(makeTarGz(entries)), { ...BIG, maxEntries: 29 }),
      "DOWNLOAD_TOO_LARGE",
      "entries",
    );
  });

  it("an entry whose header lies about size cannot dodge the uncompressed guard", async () => {
    const gz = makeTarGz([
      { name: `${PREFIX}liar.bin`, body: new Uint8Array(300_000), declaredSize: 10 },
    ]);
    const err = await rejection(
      extractTarball(bodyOf(gz), { ...BIG, maxUncompressedBytes: 100_000 }),
    );
    expect(err).toBeInstanceOf(Error);
  });
});

describe("Content-Length and cancellation (R3.9)", () => {
  it("fails before reading when Content-Length exceeds the compressed cap", async () => {
    const { body, state } = trackedBody(makeTarGz([file("a.txt", "a")]));
    await expectSummoner(
      extractTarball(body, { ...BIG, maxCompressedBytes: 1000 }, { contentLength: 1001 }),
      "DOWNLOAD_TOO_LARGE",
      "compressed",
    );
    await sleep(20);
    expect(state.pulls).toBe(0);
    expect(state.cancels).toBeGreaterThanOrEqual(1);
  });

  it("accepts a Content-Length equal to the compressed cap", async () => {
    const gz = makeTarGz([file("a.txt", "a")]);
    const tree = await extractTarball(
      bodyOf(gz),
      { ...BIG, maxCompressedBytes: gz.length },
      { contentLength: gz.length },
    );
    expect(tree.files["a.txt"]).toBe("a");
  });

  it("cancels the upstream body when an entry-count cap trips mid-download", async () => {
    // Incompressible bodies keep the archive large (~4 MB), so most of it is still unread
    // when the cap trips on the 6th entry and the cancel can reach the open upstream.
    const entries = Array.from({ length: 200 }, (_, i) =>
      file(`f${i}.txt`, randomBytes(15_000).toString("base64")),
    );
    const { body, state } = trackedBody(makeTarGz(entries), 512);
    await expectSummoner(extractTarball(body, { ...BIG, maxEntries: 5 }), "DOWNLOAD_TOO_LARGE", "entries");
    await sleep(50);
    expect(state.cancels).toBeGreaterThanOrEqual(1);
    const pulls = state.pulls;
    await sleep(100);
    expect(state.pulls).toBe(pulls);
  });
});

describe("corrupt archives map to VALIDATION_FAILED", () => {
  it("corrupt gzip", async () => {
    // 1 MiB of garbage fed in 4 KiB chunks: the bad header surfaces long before the end, so
    // the bulk is still unread and the upstream is still open to be cancelled.
    const junk = new Uint8Array(randomBytes(1 << 20));
    junk[0] = 0; // never a gzip magic
    const { body, state } = trackedBody(junk);
    await expectSummoner(extractTarball(body), "VALIDATION_FAILED");
    await sleep(50);
    expect(state.cancels).toBeGreaterThanOrEqual(1);
  });

  it("valid gzip around a corrupt tar header", async () => {
    const gz = new Uint8Array(gzipSync(Buffer.alloc(1024, 0x41)));
    await expectSummoner(extractTarball(bodyOf(gz)), "VALIDATION_FAILED");
  });

  it("truncated gzip", async () => {
    const gz = makeTarGz([file("a.txt", "a".repeat(5000))]);
    await expectSummoner(extractTarball(bodyOf(gz.subarray(0, 40))), "VALIDATION_FAILED");
  });
});

describe("error ordering and unhandled errors (spike findings)", () => {
  it("a guard trip mid-entry rejects with the guard error and leaks no unhandled error", async () => {
    const leaked: unknown[] = [];
    const onUncaught = (e: unknown): void => void leaked.push(e);
    process.on("uncaughtException", onUncaught);
    process.on("unhandledRejection", onUncaught);
    try {
      // One kept text file whose body is in flight when the uncompressed cap trips.
      // Incompressible text (~600 KB gz) so most of the body is unread when the cap trips.
      const gz = makeTarGz([file("big.txt", randomBytes(450_000).toString("base64"))]);
      const { body, state } = trackedBody(gz, 1024);
      const err = await expectSummoner(
        extractTarball(body, { ...BIG, maxUncompressedBytes: 100_000 }),
        "DOWNLOAD_TOO_LARGE",
        "uncompressed",
      );
      expect(err.code).toBe("DOWNLOAD_TOO_LARGE"); // guard error wins over stream-destroy errors
      await sleep(150);
      expect(state.cancels).toBeGreaterThanOrEqual(1);
      expect(leaked).toEqual([]);
    } finally {
      process.off("uncaughtException", onUncaught);
      process.off("unhandledRejection", onUncaught);
    }
  });

  it("the same holds when the in-flight entry is a skipped one", async () => {
    const leaked: unknown[] = [];
    const onUncaught = (e: unknown): void => void leaked.push(e);
    process.on("uncaughtException", onUncaught);
    process.on("unhandledRejection", onUncaught);
    try {
      const gz = makeTarGz([{ name: `${PREFIX}vendor/big.js`, body: "q".repeat(600_000) }]);
      await expectSummoner(
        extractTarball(bodyOf(gz), { ...BIG, maxUncompressedBytes: 100_000 }),
        "DOWNLOAD_TOO_LARGE",
        "uncompressed",
      );
      await sleep(150);
      expect(leaked).toEqual([]);
    } finally {
      process.off("uncaughtException", onUncaught);
      process.off("unhandledRejection", onUncaught);
    }
  });
});

describe("slow: real default cap at scale (R3.10)", () => {
  const slow = process.env["NECRO_SLOW_TESTS"] === "1";

  it.skipIf(!slow)(
    "a lazily generated zero-filled archive past 200 MB trips the real default guard",
    async () => {
      const body = lazyZeroFileTarGz({
        name: `${PREFIX}zeros.bin`,
        size: DEFAULT_LIMITS.maxUncompressedBytes + 1_048_576,
      });
      await expectSummoner(extractTarball(body), "DOWNLOAD_TOO_LARGE", "uncompressed");
    },
    180_000,
  );
});
