// src/snapshot/types.ts
//
// Snapshot types and zod schemas for the Oracle Deck Engine. A RepoSnapshot is
// the pure, in-memory representation of a repository at a specific commit that
// all detectors read from. It carries file metadata, repo metadata, parsed
// manifests, and the file contents (a runtime Map keyed by path).

import { z } from "zod";

// --- RepoRef ---
export const RepoRefSchema = z.object({
  owner: z.string().min(1),
  name: z.string().min(1),
  sha: z.string().min(1),
  defaultBranch: z.string().min(1),
});
export type RepoRef = z.infer<typeof RepoRefSchema>;

// --- FileEntry ---
export const LangSchema = z.enum(["python", "js", "ts", "html", "other"]);
export type Lang = z.infer<typeof LangSchema>;

export const FileEntrySchema = z.object({
  path: z.string().min(1),
  size: z.number().int().nonnegative().describe("File size in bytes"),
  lang: LangSchema,
  sha: z.string(),
});
export type FileEntry = z.infer<typeof FileEntrySchema>;

// --- RepoMeta ---
export const RepoMetaSchema = z.object({
  pushedAt: z.string().nullable().describe("ISO 8601 UTC string or null"),
  isArchived: z.boolean(),
  openIssueCount: z.number().int().nonnegative(),
  openPRCount: z.number().int().nonnegative(),
  oldestOpenPRAgeDays: z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .describe("Age in whole days of oldest open PR, or null"),
  latestReleaseAt: z.string().nullable().describe("ISO 8601 UTC string or null"),
  licenseKey: z
    .string()
    .nullable()
    .describe("SPDX identifier, 'NOASSERTION', or null if absent"),
});
export type RepoMeta = z.infer<typeof RepoMetaSchema>;

// --- Oversize file evidence item (subset of Evidence) ---
export const OversizeFileItemSchema = z.object({
  kind: z.literal("file_skipped"),
  path: z.string(),
  detail: z.literal("too large to divine"),
  source: z.literal("static"),
});
export type OversizeFileItem = z.infer<typeof OversizeFileItemSchema>;

// --- RepoSnapshot ---
// Note: `contents` is a Map<string, string> at runtime (keyed by file path → file text).
// In test fixtures and serialized form (buildSnapshotFromFileMap input), it is
// Record<string, string>. The zod schema validates the plain-object form;
// buildSnapshotFromFileMap converts it to a Map internally.
export const RepoSnapshotSchema = z.object({
  ref: RepoRefSchema,
  files: z.array(FileEntrySchema),
  meta: RepoMetaSchema,
  manifests: z.array(z.unknown()).describe("Parsed manifests; typed as Manifest[] in manifest.ts"),
  // contents is runtime Map<string, string>; validated indirectly through builder functions
  oversizeFiles: z.array(OversizeFileItemSchema),
  truncated: z.boolean(),
  createdAt: z.string().describe("ISO 8601 UTC string set at snapshot construction time"),
});
// The runtime type adds the contents Map:
export type RepoSnapshot = z.infer<typeof RepoSnapshotSchema> & {
  contents: Map<string, string>;
};

// --- GitHubSnapshotBuilder interface ---
export interface GitHubSnapshotBuilder {
  build(ref: RepoRef): Promise<RepoSnapshot>;
}
