import tar from "tar-stream";
import { describe, expect, it } from "vitest";
import {
  endOfArchive,
  entryBytes,
  gnuLongNameEntry,
  paxExtendedEntry,
  paxGlobalEntry,
  paxRecord,
  tarHeader,
} from "./raw-tar.js";
import { makeTar } from "./make-tar-gz.js";

const dec = new TextDecoder();

interface Seen {
  name: string;
  type: string | null | undefined;
  linkname: string | null | undefined;
  body: string;
}

async function extract(bytes: Uint8Array): Promise<Seen[]> {
  const ex = tar.extract();
  const seen: Seen[] = [];
  const done = new Promise<void>((resolve, reject) => {
    ex.on("entry", (header, stream, next) => {
      const chunks: Buffer[] = [];
      stream.on("data", (c: unknown) => {
        chunks.push(c as Buffer);
      });
      stream.on("error", reject);
      stream.on("end", () => {
        seen.push({
          name: header.name,
          type: header.type,
          linkname: header.linkname,
          body: Buffer.concat(chunks).toString("utf8"),
        });
        next();
      });
    });
    ex.on("finish", resolve);
    ex.on("error", reject);
  });
  ex.end(Buffer.from(bytes));
  await done;
  return seen;
}

describe("raw-tar builder (R9.4, R9.5)", () => {
  it("writes 512-byte headers with a valid checksum", () => {
    const h = tarHeader({ name: "a.txt" }, 5);
    expect(h).toHaveLength(512);
    const copy = h.slice();
    copy.fill(0x20, 148, 156);
    const sum = copy.reduce((n, b) => n + b, 0);
    expect(parseInt(dec.decode(h.subarray(148, 154)), 8)).toBe(sum);
    expect(dec.decode(h.subarray(257, 262))).toBe("ustar");
  });

  it("pads bodies to a 512-byte boundary", () => {
    expect(entryBytes({ name: "a", body: "" })).toHaveLength(512);
    expect(entryBytes({ name: "a", body: "x" })).toHaveLength(1024);
    expect(entryBytes({ name: "a", body: "x".repeat(512) })).toHaveLength(1024);
    expect(entryBytes({ name: "a", body: "x".repeat(513) })).toHaveLength(1536);
  });

  it("honors declaredSize in the header without changing the body", () => {
    const bytes = entryBytes({ name: "a", body: "hi", declaredSize: 1000 });
    expect(parseInt(dec.decode(bytes.subarray(124, 135)), 8)).toBe(1000);
    expect(bytes).toHaveLength(1024);
  });

  it("ends an archive with two zero blocks", () => {
    const end = endOfArchive();
    expect(end).toHaveLength(1024);
    expect(end.every((b) => b === 0)).toBe(true);
  });

  it("produces pax records whose length prefix counts itself", () => {
    for (const [k, v] of [["path", "a"], ["comment", "x".repeat(40)], ["path", "y".repeat(90)]] as const) {
      const rec = paxRecord(k, v);
      expect(rec.endsWith("\n")).toBe(true);
      expect(Number(rec.split(" ")[0])).toBe(new TextEncoder().encode(rec).length);
    }
  });

  it("round-trips regular files, directories and empty files", async () => {
    const seen = await extract(
      makeTar([
        { name: "root/", typeflag: "5" },
        { name: "root/a.py", body: "print 1\n" },
        { name: "root/empty", body: "" },
        { name: "root/big", body: "z".repeat(1500) },
      ]),
    );
    expect(seen.map((s) => [s.name, s.type])).toEqual([
      ["root/", "directory"],
      ["root/a.py", "file"],
      ["root/empty", "file"],
      ["root/big", "file"],
    ]);
    expect(seen[1]?.body).toBe("print 1\n");
    expect(seen[3]?.body).toHaveLength(1500);
  });

  it.each([
    ["dot-dot", "root/../../etc/passwd"],
    ["absolute", "/etc/passwd"],
    ["backslash traversal", "root\\..\\..\\evil"],
  ])("emits a hostile %s name verbatim", async (_label, name) => {
    const seen = await extract(makeTar([{ name, body: "x" }]));
    expect(seen).toHaveLength(1);
    expect(seen[0]?.name).toBe(name);
  });

  it.each([
    ["symlink", "2", "symlink"],
    ["hard link", "1", "link"],
    ["character device", "3", "character-device"],
    ["block device", "4", "block-device"],
    ["FIFO", "6", "fifo"],
  ])("emits a %s entry", async (_label, typeflag, expected) => {
    const seen = await extract(makeTar([{ name: "root/x", typeflag, linkname: "../../target" }]));
    expect(seen[0]?.type).toBe(expected);
    if (typeflag === "1" || typeflag === "2") expect(seen[0]?.linkname).toBe("../../target");
  });

  it("emits pax global (g) and extended (x) headers that tar-stream resolves", async () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    const long = `root/${"nested-dir/".repeat(12)}file.py`;
    const seen = await extract(
      makeTar([paxGlobalEntry({ comment: sha }), paxExtendedEntry({ path: long }), { name: "placeholder", body: "v" }]),
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]?.name).toBe(long);
    expect(seen[0]?.body).toBe("v");
  });

  it("emits GNU long-name (L) entries that tar-stream resolves", async () => {
    const long = `root/${"d".repeat(60)}/${"e".repeat(60)}/f.py`;
    const seen = await extract(makeTar([gnuLongNameEntry(long), { name: "short", body: "1" }]));
    expect(seen.map((s) => s.name)).toEqual([long]);
  });
});
