// src/arcana/manifest-assets.test.ts
//
// Item 30 (judge-ready-pass): every manifest entry resolves to a real file on
// disk, with a RECORDED checksum.
//
// The committed manifest now registers all 22 Major-Arcana cards plus the Seer
// and the two Necronomicon assets. This guard proves, for EVERY manifest entry:
//   1. the `<id>.webp` asset exists on disk under apps/web/public/arcana/, and
//   2. its SHA-256 equals the recorded checksum below.
//
// Recording the checksum (not just existence) also enforces the item-30
// constraint that the newly added card art is used VERBATIM: if any image's
// bytes are regenerated, recompressed, or renamed, its hash changes and this
// test fails loudly. When art is INTENTIONALLY updated, the recorded hash must
// be updated in the same change with a reason.
//
// The manifest is read as plain data (never imported as a module) via the same
// six-hop relative path the sibling manifest.test.ts uses.
//
// Validates: judge-ready-pass item 30.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadManifest } from "./manifest.js";

/** apps/web/public/arcana/, six hops up from this file. */
const ARCANA_DIR = new URL(
  "../../../../apps/web/public/arcana/",
  import.meta.url,
);

const REAL_MANIFEST: unknown = JSON.parse(
  readFileSync(fileURLToPath(new URL("manifest.json", ARCANA_DIR)), "utf8"),
);

/**
 * Recorded SHA-256 (lowercase hex) of every committed arcana asset. Keyed by
 * manifest id -> `<id>.webp`. Updating an image's bytes REQUIRES updating its
 * hash here, in the same change, with a reason — that is the point of the guard.
 */
const RECORDED_SHA256: Readonly<Record<string, string>> = {
  judgement: "c303a4d8cb91636582a535505977fee52d2614282e6cd28ebd0b507b6bab7181",
  tower: "3fac2224c94e80d4bf59ae3527ebd6891e657423e3172c2b67a018c4e82dcf4f",
  devil: "f445e8eeb46d01e7ae14bef62d581450f3574bdc7709d5ba4194965a75a40098",
  death: "2b4ea8a90d804d8936bb17f34c1b4865255c8d91525e5f03aaf452f7d9dbc237",
  wheel: "63b8f37b13a4b041f9ec68f509649cf83ef375bb38aefd73a63d9095eb944101",
  hermit: "153b59904f5a532b6f2a11e8935552a880d6d37ec4b82135f7e4b12ddf3920a3",
  hanged_man: "04e2da26cc196a40663f3e20b70985e07eb30def55c6c5aeb14aa179af86951f",
  temperance: "9e6112de53fedae2604b3cdb393a9346d0009564f2de45948d72622f052e32ad",
  justice: "559354e1b5c45d6a9dda6d8ad8a3ab8e16799d32cff2562dedfa439c71e8e0ad",
  moon: "31259b6ef3f166d7e97deb8e0b8bce5787968250e601f3b2d067109318484135",
  star: "59b6c1e4ab43dd084ba308e9565c0d513baf1107ae10efa52692441d86a8c873",
  world: "521d730f3d4b13438b5ac436831c35a4e6451c813f61dea7d6d0ae5fdf93f0f7",
  fool: "9d05dde11536874eee28aabef073be456e352df216bd0b0011c8d130719b5de0",
  magician: "ad070d6fa0d79e91639cf14ecbd4c6b6eb9717c9330997f1afb59d808c50047e",
  high_priestess: "6e727870a736a728cede4cdd0a29d0f223d7817fd8ece3abc41a2ff13f785930",
  empress: "97852405cf33d30d76d9145bc271cb87f8bc278a171b3c1d7f3e41419e48f921",
  emperor: "0e1be6394ae71573bd1ec0f165e940cce72f7d578ecc114c125c2514f8ad1d4d",
  hierophant: "783bf0b749439d319c65c2db9ae527ad882d229baba4887237cace450f421932",
  lovers: "48f6782564371c3147921e6eb2420473e89720a335ef67147b26a9858531824f",
  chariot: "e35bd72ad20f9b4e3db33b15038f2bd5212b20717d193d321cefc4ff947354ca",
  strength: "ec4fcadde46315c8442818f2fe7ad48986509adae3e74d02681fe6920ed5d6b2",
  sun: "d4e598a17c39742f6a33d6cb172bf2408314428e6002ae6eb78b0b26c5e97c78",
  seer: "10052a458395626d2990fc58b917ed69111b518a1407968fdd4fb6cc40b30a2e",
  "necronomicon-closed":
    "84f944f5fce25da59818eae9409dee4e4d1888b018e99b70e6a8d15e2348fb0a",
  "necronomicon-open":
    "20f6ddc568cbc415ca2bebac665776b8aeb1cc058f6bd413ca612ac7eeff6012",
};

function sha256Of(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const assets = loadManifest(REAL_MANIFEST);

describe("item 30: every manifest entry resolves to a file on disk with a recorded checksum", () => {
  it("registers all 22 Major-Arcana cards plus seer + 2 necronomicon (25 assets)", () => {
    expect(assets.size).toBe(25);
    const MAJOR_ARCANA = [
      "fool", "magician", "high_priestess", "empress", "emperor",
      "hierophant", "lovers", "chariot", "strength", "hermit",
      "wheel", "justice", "hanged_man", "death", "temperance",
      "devil", "tower", "star", "moon", "sun", "judgement", "world",
    ];
    for (const id of MAJOR_ARCANA) {
      expect(assets.get(id), `major arcana "${id}" missing from manifest`).toBeDefined();
    }
  });

  it("every manifest id has a recorded checksum entry", () => {
    const manifestIds = [...assets.keys()].sort();
    const recordedIds = Object.keys(RECORDED_SHA256).sort();
    expect(recordedIds).toEqual(manifestIds);
  });

  it("every manifest entry resolves to a .webp on disk whose SHA-256 matches the record", () => {
    for (const id of assets.keys()) {
      const file = fileURLToPath(new URL(`${id}.webp`, ARCANA_DIR));
      expect(existsSync(file), `asset file missing on disk for "${id}": ${file}`).toBe(true);
      const actual = sha256Of(file);
      const recorded = RECORDED_SHA256[id];
      expect(
        actual,
        `checksum drift for "${id}" (bytes changed? regenerate the record with a reason)`,
      ).toBe(recorded);
    }
  });
});