// Streaming tarball extraction with hard caps (spec 02-github-summoner, task 21.5).
// Requirements: R3.2, R3.3, R3.4, R3.5, R3.6, R3.9, R3.10, R3.11, R3.13, R4.6.
// Repository content is data: it is decoded to strings and never executed.
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import tar from "tar-stream";
import {
  BINARY_SNIFF_BYTES,
  MAX_COMPRESSED_BYTES,
  MAX_ENTRIES,
  MAX_UNCOMPRESSED_BYTES,
  TEXT_FILE_CEILING_BYTES,
  VENDORED_SEGMENTS,
} from "./constants.js";
import { isBinarySample, normalizeEntryPath } from "./entry-path.js";
import { SummonerError, summonerError } from "./errors.js";

export interface ExtractionLimits {
  readonly maxCompressedBytes: number;
  readonly maxUncompressedBytes: number;
  readonly maxEntries: number;
}

export const DEFAULT_LIMITS: ExtractionLimits = {
  maxCompressedBytes: MAX_COMPRESSED_BYTES,
  maxUncompressedBytes: MAX_UNCOMPRESSED_BYTES,
  maxEntries: MAX_ENTRIES,
};

export interface ExtractedTree {
  /** Null-prototype object: a file named "__proto__" is an ordinary key. */
  readonly files: Record<string, string>;
  readonly hasWorkflowsDir: boolean;
  readonly stats: {
    readonly entries: number;
    readonly skippedTraversal: number;
    readonly skippedLinks: number;
    readonly skippedSpecial: number;
    readonly skippedVendored: number;
    readonly skippedBinary: number;
    readonly oversize: number;
  };
}

export interface ExtractOptions {
  /** Declared Content-Length of the compressed body, when known. */
  readonly contentLength?: number | null;
}

/** One shared sentinel for every oversize text file (design D4). */
const OVERSIZE_SENTINEL = "x".repeat(TEXT_FILE_CEILING_BYTES + 1);

const tooLarge = (limit: "compressed" | "uncompressed" | "entries"): SummonerError =>
  summonerError("DOWNLOAD_TOO_LARGE", { limit });

const corrupt = (cause: unknown): SummonerError =>
  summonerError(
    "VALIDATION_FAILED",
    { what: "The archive", where: "tarball", reason: "corrupt-archive" },
    cause,
  );

const mapError = (e: unknown): SummonerError => (e instanceof SummonerError ? e : corrupt(e));

/** Pass-through transform that errors the pipeline once more than `maxBytes` have passed. */
function capStream(maxBytes: number, onExceed: () => Error): TransformStream<Uint8Array, Uint8Array> {
  let seen = 0;
  let tripped = false;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (tripped) return;
      seen += chunk.length;
      if (seen > maxBytes) {
        tripped = true;
        controller.error(onExceed());
        return;
      }
      controller.enqueue(chunk);
    },
  });
}

function concat(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

export function extractTarball(
  body: ReadableStream<Uint8Array>,
  limits: Partial<ExtractionLimits> = {},
  options: ExtractOptions = {},
): Promise<ExtractedTree> {
  const lim: ExtractionLimits = { ...DEFAULT_LIMITS, ...limits };
  const declared = options.contentLength;

  if (declared !== undefined && declared !== null && declared > lim.maxCompressedBytes) {
    body.cancel().catch(() => undefined);
    return Promise.reject(tooLarge("compressed"));
  }

  return new Promise<ExtractedTree>((resolve, reject) => {
    const files: Record<string, string> = Object.create(null) as Record<string, string>;
    const stats = {
      entries: 0,
      skippedTraversal: 0,
      skippedLinks: 0,
      skippedSpecial: 0,
      skippedVendored: 0,
      skippedBinary: 0,
      oversize: 0,
    };
    let hasWorkflowsDir = false;
    let settled = false;

    // We own the upstream reader and pace it: the next chunk is read only after the
    // decompressor has accepted the previous one. A failure therefore lands while the upstream
    // is still open, and cancelling the reader really stops the download (R3.9).
    const reader = body.getReader();
    const gunzip = new DecompressionStream("gzip");
    const writer = gunzip.writable.getWriter();

    // Guard trips settle immediately with the guard error, so it wins over the secondary
    // errors that tearing down the pipeline emits afterwards.
    const guarded = (gunzip.readable as unknown as ReadableStream<Uint8Array>).pipeThrough(
      capStream(lim.maxUncompressedBytes, () => {
        const err = tooLarge("uncompressed");
        fail(err);
        return err;
      }),
    );
    const source = Readable.fromWeb(guarded as unknown as NodeReadableStream<Uint8Array>);
    const extract = tar.extract();

    function fail(err: unknown): void {
      if (settled) return;
      settled = true;
      const mapped = mapError(err);
      reader.cancel(mapped).catch(() => undefined);
      writer.abort(mapped).catch(() => undefined);
      extract.destroy(mapped);
      source.destroy(mapped);
      reject(mapped);
    }

    const pump = async (): Promise<void> => {
      let compressedSeen = 0;
      try {
        for (;;) {
          await writer.ready;
          if (settled) return;
          const { done, value } = await reader.read();
          if (settled) return;
          if (done) {
            await writer.close();
            return;
          }
          compressedSeen += value.length;
          if (compressedSeen > lim.maxCompressedBytes) {
            fail(tooLarge("compressed"));
            return;
          }
          // Copy into a fresh ArrayBuffer-backed view: the reader yields
          // Uint8Array<ArrayBufferLike> (which may wrap a SharedArrayBuffer),
          // but the writer's BufferSource parameter requires ArrayBuffer backing.
          await writer.write(new Uint8Array(value));
        }
      } catch (e) {
        fail(e);
      }
    };

    source.on("error", fail);
    extract.on("error", fail);
    extract.on("finish", () => {
      if (settled) return;
      settled = true;
      resolve({ files, hasWorkflowsDir, stats });
    });

    extract.on("entry", (header, stream, next) => {
      // First statement: destroying extract also errors the in-flight entry stream.
      stream.on("error", fail);
      if (settled) {
        stream.resume();
        return;
      }

      stats.entries += 1;
      if (stats.entries > lim.maxEntries) {
        fail(tooLarge("entries"));
        return;
      }

      const skip = (): void => {
        stream.on("end", next);
        stream.resume();
      };

      const normalized = normalizeEntryPath(header.name);
      if (normalized.kind === "traversal") {
        stats.skippedTraversal += 1;
        return skip();
      }
      if (normalized.kind === "root") return skip();

      const type = header.type;
      if (type === "symlink" || type === "link") {
        stats.skippedLinks += 1;
        return skip();
      }
      const segments = normalized.path.split("/");
      if (type === "directory") {
        if (segments[0] === ".github" && segments[1] === "workflows") hasWorkflowsDir = true;
        return skip();
      }
      if (type !== "file") {
        stats.skippedSpecial += 1;
        return skip();
      }
      if (segments.some((s) => VENDORED_SEGMENTS.has(s))) {
        stats.skippedVendored += 1;
        return skip();
      }
      if (segments.length >= 3 && segments[0] === ".github" && segments[1] === "workflows") {
        hasWorkflowsDir = true;
      }

      const path = normalized.path;
      const declaredSize = header.size ?? 0;
      let mode: "undecided" | "keep" | "drain" = "undecided";
      let chunks: Uint8Array[] = [];
      let collected = 0;

      const decide = (): void => {
        const sample = concat(chunks, collected);
        if (isBinarySample(sample)) {
          stats.skippedBinary += 1;
          mode = "drain";
        } else if (declaredSize > TEXT_FILE_CEILING_BYTES) {
          stats.oversize += 1;
          files[path] = OVERSIZE_SENTINEL;
          mode = "drain";
        } else {
          mode = "keep";
        }
        if (mode === "drain") {
          chunks = [];
          collected = 0;
        }
      };

      stream.on("data", (data: unknown) => {
        const chunk = data as Uint8Array;
        if (mode === "drain") return;
        chunks.push(chunk);
        collected += chunk.length;
        if (mode === "undecided" && collected >= BINARY_SNIFF_BYTES) decide();
      });
      stream.on("end", () => {
        if (settled) return;
        if (mode === "undecided") decide();
        if (mode === "keep") {
          files[path] = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true }).decode(
            concat(chunks, collected),
          );
        }
        chunks = [];
        next();
      });
    });

    source.pipe(extract);
    void pump();
  });
}
