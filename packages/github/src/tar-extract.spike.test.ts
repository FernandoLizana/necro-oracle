/**
 * Characterization spike for the tar-stream bridge (spec 02-github-summoner, tasks 1.2 and 1.3).
 * Validates R3.1, R3.3, R3.9, R3.13 (and groundwork for R3.10, R3.11): these tests assert what
 * the design ASSUMES about `tar-stream` and the `Readable.fromWeb` bridge. Not weakened to pass.
 *
 * FINDINGS (task 1.3)
 * - Library: tar-stream@3.2.2 (exact pin). Declares bare-fs (plus b4a, streamx, fast-fifo);
 *   we never call any fs path, but bare-fs enlarges the install footprint.
 * - (a) Headers: pax global (typeflag g) and pax extended (typeflag x) headers and GNU
 *   long-name (L) entries are resolved internally. The g header never surfaces as an entry;
 *   x/L set header.name to the full long path. A sha `comment` in the global header does not
 *   disturb paths. Traversal names ("root/../../etc/passwd") pass through verbatim, so our
 *   own normalizer must reject them.
 * - (b) Cancellation: destroying extract and the Readable.fromWeb bridge cancels the upstream
 *   reader and pulling stops. A byte-counting TransformStream guard placed BEFORE the bridge
 *   that errors does the same (error surfaces through extract, upstream cancelled).
 * - Iterator finding: `for await` / extract[Symbol.asyncIterator]() does NOT block on an
 *   unconsumed entry; next() auto-drains and discards it. The event form
 *   `extract.on("entry", (header, stream, next) => ...)` blocks until stream.resume() + next().
 * - Event-form hazard: when extract is destroyed with an error (guard trip), the in-flight
 *   entry stream also emits `error`; with no listener it is an uncaught exception. Every entry
 *   handler must attach `stream.on("error", ...)` (the iterator form hid this).
 * - Decision: the extractor uses the EVENT form with explicit next() (design D3). An upstream
 *   guard counts every byte of skipped entries (see the P11 groundwork tests below).
 */
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import tar from "tar-stream";
import { describe, expect, it } from "vitest";
import { makeTar, makeTarGz } from "./testing/make-tar-gz.js";
import {
  entryBytes,
  gnuLongNameEntry,
  paxExtendedEntry,
  paxGlobalEntry,
  type RawTarEntry,
} from "./testing/raw-tar.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function webFrom(bytes: Uint8Array, chunkSize = 700): ReadableStream<Uint8Array> {
  let at = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at >= bytes.length) return controller.close();
      controller.enqueue(bytes.subarray(at, at + chunkSize));
      at += chunkSize;
    },
  });
}

function bridge(web: ReadableStream<Uint8Array>): Readable {
  return Readable.fromWeb(web as unknown as NodeReadableStream<Uint8Array>);
}

async function readAll(entry: AsyncIterable<unknown>): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of entry) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks).toString("utf8");
}

interface Seen {
  readonly name: string;
  readonly type: string | null | undefined;
  readonly body: string;
}

async function extractAll(gz: Uint8Array): Promise<Seen[]> {
  const guarded = webFrom(gz).pipeThrough(new DecompressionStream("gzip"));
  const extract = tar.extract();
  const source = bridge(guarded);
  source.on("error", (e) => extract.destroy(e));
  source.pipe(extract);
  const seen: Seen[] = [];
  for await (const entry of extract) {
    seen.push({ name: entry.header.name, type: entry.header.type, body: await readAll(entry) });
  }
  return seen;
}

describe("spike (R3.1, R3.13): pax and GNU headers through Readable.fromWeb -> tar.extract", () => {
  const prefix = `owner-repo-${SHA}/`;
  const shaged: RawTarEntry[] = [
    paxGlobalEntry({ comment: SHA }),
    { name: prefix, typeflag: "5" },
    { name: `${prefix}README.md`, body: "hello" },
    { name: `${prefix}src/app.py`, body: "print 1\n" },
  ];

  it("never surfaces the pax global header (typeflag g) as an entry", async () => {
    const seen = await extractAll(makeTarGz(shaged));
    expect(seen.map((s) => s.name)).not.toContain("pax_global_header");
    expect(seen.some((s) => s.type === "pax-global-header")).toBe(false);
    expect(seen).toHaveLength(3);
  });

  it("keeps file paths intact and bodies readable despite the sha comment", async () => {
    const seen = await extractAll(makeTarGz(shaged));
    expect(seen.map((s) => s.name)).toEqual([prefix, `${prefix}README.md`, `${prefix}src/app.py`]);
    expect(seen[0]?.type).toBe("directory");
    expect(seen[1]).toMatchObject({ type: "file", body: "hello" });
    expect(seen[2]?.body).toBe("print 1\n");
  });

  it("resolves a pax extended header path (typeflag x) over 100 chars", async () => {
    const longPath = `${prefix}${"deeply-nested-directory/".repeat(8)}module.py`;
    expect(longPath.length).toBeGreaterThan(100);
    const seen = await extractAll(
      makeTarGz([
        paxGlobalEntry({ comment: SHA }),
        paxExtendedEntry({ path: longPath }),
        { name: "truncated-placeholder-name", body: "x = 1\n" },
      ]),
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]?.name).toBe(longPath);
    expect(seen[0]?.body).toBe("x = 1\n");
  });

  it("resolves a GNU long-name entry (typeflag L)", async () => {
    const longPath = `${prefix}${"gnu-long-segment/".repeat(9)}file.py`;
    expect(longPath.length).toBeGreaterThan(100);
    const seen = await extractAll(
      makeTarGz([gnuLongNameEntry(longPath), { name: longPath.slice(0, 100), body: "y = 2\n" }]),
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]?.name).toBe(longPath);
    expect(seen[0]?.body).toBe("y = 2\n");
  });
});

describe("spike (R3.3): traversal names are passed through verbatim by tar-stream", () => {
  it("reports the raw name so our normalizer must reject it", async () => {
    const seen = await extractAll(makeTarGz([{ name: "root/../../etc/passwd", body: "x" }]));
    expect(seen.map((s) => s.name)).toEqual(["root/../../etc/passwd"]);
  });
});

/** Lazily generates one 4 KiB file entry per pull, then never ends within the test. */
function lazyArchive(totalEntries: number) {
  const state = { pulls: 0, cancels: 0, cancelReason: undefined as unknown };
  const body = "a".repeat(4096);
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (state.pulls >= totalEntries) return controller.close();
      const n = state.pulls++;
      controller.enqueue(entryBytes({ name: `root/file-${n}.txt`, body }));
    },
    cancel(reason) {
      state.cancels++;
      state.cancelReason = reason;
    },
  });
  return { state, stream };
}

describe("spike (R3.9): cancellation propagates upstream", () => {
  it("destroying extract and the bridge cancels the upstream reader and stops pulling", async () => {
    const { state, stream } = lazyArchive(5000);
    const extract = tar.extract();
    const source = bridge(stream);
    source.on("error", () => undefined);
    extract.on("error", () => undefined);
    source.pipe(extract);

    let consumed = 0;
    for await (const entry of extract) {
      await readAll(entry);
      if (++consumed === 3) break;
    }
    extract.destroy();
    source.destroy();
    await sleep(50);
    const pullsAtSettle = state.pulls;
    await sleep(100);

    expect(state.cancels).toBeGreaterThanOrEqual(1);
    expect(state.pulls).toBe(pullsAtSettle);
    expect(state.pulls).toBeLessThan(5000);
  });

  it("a byte-counting guard error before the bridge stops the pull and cancels upstream", async () => {
    const { state, stream } = lazyArchive(5000);
    let seenBytes = 0;
    const limit = 40_000;
    const guard = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seenBytes += chunk.length;
        if (seenBytes > limit) controller.error(new Error("cap exceeded"));
        else controller.enqueue(chunk);
      },
    });
    const extract = tar.extract();
    const source = bridge(stream.pipeThrough(guard));
    source.on("error", (e) => extract.destroy(e));
    source.pipe(extract);

    let failure: unknown;
    try {
      for await (const entry of extract) await readAll(entry);
    } catch (e) {
      failure = e;
    }
    await sleep(50);
    const pullsAtSettle = state.pulls;
    await sleep(100);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("cap exceeded");
    expect(state.cancels).toBeGreaterThanOrEqual(1);
    expect(state.pulls).toBe(pullsAtSettle);
    expect(state.pulls).toBeLessThan(5000);
  });
});

describe("spike: sequential entry consumption", () => {
  const archive = makeTar([
    { name: "root/a.txt", body: "a".repeat(2000) },
    { name: "root/b.txt", body: "bee" },
  ]);

  it("event form: an unconsumed entry blocks the next entry; entry.resume() + next() drains it", async () => {
    const extract = tar.extract();
    bridge(webFrom(archive)).pipe(extract);
    const names: string[] = [];
    let release: (() => void) | undefined;
    extract.on("entry", (header, stream, next) => {
      names.push(header.name);
      if (names.length === 1) {
        release = () => {
          stream.on("end", next);
          stream.resume();
        };
      } else {
        stream.on("end", next);
        stream.resume();
      }
    });
    await sleep(100);
    expect(names).toEqual(["root/a.txt"]);
    release?.();
    await sleep(100);
    expect(names).toEqual(["root/a.txt", "root/b.txt"]);
    extract.destroy();
  });

  // CHARACTERIZATION (not an assumption): the async-iterator form does NOT block on an
  // unconsumed entry. it.next() auto-drains and discards the previous entry, so the next
  // entry is yielded even though entry 1 was never read. That is why the extractor does NOT
  // use `for await` / the iterator form and instead uses the event form
  // `extract.on("entry", (header, stream, next) => ...)` with an explicit next(), where we
  // own draining and sequencing (see design D3).
  it("async-iterator form: leaving entry 1 unread and calling next() still yields entry 2 (auto-drain)", async () => {
    const extract = tar.extract();
    bridge(webFrom(archive)).pipe(extract);
    const it = extract[Symbol.asyncIterator]();

    const first = await it.next();
    expect(first.done).toBe(false);
    expect(first.value.header.name).toBe("root/a.txt");

    // Entry 1 is deliberately never read or resumed.
    const second = await it.next();
    expect(second.done).toBe(false);
    expect(second.value.header.name).toBe("root/b.txt");
    expect(await readAll(second.value)).toBe("bee");
    extract.destroy();
  });
});

describe("spike P11 groundwork (R3.10, R3.11): upstream byte guard counts skipped-entry bytes", () => {
  const SKIPPED = 12;
  const BODY = 8192;
  const archive = makeTar([
    { name: "root/keep.txt", body: "kept" },
    ...Array.from({ length: SKIPPED }, (_, i) => ({ name: `root/skipped-${i}.bin`, body: "z".repeat(BODY) })),
  ]);
  const skippedTotal = SKIPPED * BODY;

  /** Event form: skip (drain with resume) every entry except keep.txt; never reads skipped bodies. */
  function run(limit: number) {
    const state = { cancels: 0, counted: 0, bodyBytesRead: 0, names: [] as string[] };
    let at = 0;
    const upstream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (at >= archive.length) return controller.close();
        controller.enqueue(archive.subarray(at, at + 1000));
        at += 1000;
      },
      cancel() {
        state.cancels++;
      },
    });
    let tripped = false;
    const guard = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (tripped) return;
        state.counted += chunk.length;
        if (state.counted > limit) {
          tripped = true;
          controller.error(new Error("cap exceeded"));
        } else controller.enqueue(chunk);
      },
    });
    const extract = tar.extract();
    const source = bridge(upstream.pipeThrough(guard));
    source.on("error", (e) => extract.destroy(e));
    source.pipe(extract);
    extract.on("entry", (header, stream, next) => {
      state.names.push(header.name);
      // Destroying extract with an error also errors the in-flight entry stream; without a
      // listener that is an uncaught exception. The real extractor must do the same.
      stream.on("error", () => undefined);
      if (header.name === "root/keep.txt") {
        stream.on("data", (c: unknown) => (state.bodyBytesRead += (c as Uint8Array).length));
      }
      stream.on("end", next);
      stream.resume();
    });
    const done = new Promise<unknown>((resolve) => {
      extract.on("finish", () => resolve(undefined));
      extract.on("error", (e) => resolve(e));
    });
    return { state, done };
  }

  it("P11 groundwork: guard counts every byte of skipped entries (completes under a large limit)", async () => {
    const { state, done } = run(10_000_000);
    expect(await done).toBeUndefined();
    expect(state.names).toHaveLength(SKIPPED + 1);
    expect(state.bodyBytesRead).toBe(4); // only the kept file was read by the handler
    expect(state.counted).toBeGreaterThanOrEqual(skippedTotal);
  });

  it("P11 groundwork: guard fires on an archive whose bulk is skipped entries; upstream cancelled", async () => {
    const limit = 30_000;
    const { state, done } = run(limit);
    const failure = await done;
    await sleep(50);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("cap exceeded");
    expect(state.counted).toBeGreaterThan(limit);
    expect(state.counted).toBeLessThan(archive.length);
    expect(state.bodyBytesRead).toBeLessThanOrEqual(4);
    expect(state.cancels).toBeGreaterThanOrEqual(1);
  });
});