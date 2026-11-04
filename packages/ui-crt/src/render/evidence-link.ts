// Evidence_Link construction for @necro/ui-crt (task 8.2, Property 17).
//
// Validates: Requirements R14.4, R14.5, R14.6
//
// `buildEvidenceLink` is the ONLY place that produces a segment `href` (design
// decision D4): a GitHub blob URL pointing at the file and line an `Evidence`
// came from. The path is split on `/`, each segment is percent-encoded with
// `encodeURIComponent` (so spaces, unicode and URL-reserved characters are
// escaped) and re-joined with `/`, keeping the directory structure in the URL
// while making every segment safe. A `#L{line}` fragment is added only when
// `line` is a defined integer. When the evidence carries no `path` there is
// nothing to link to, so the function returns `null` and the caller renders
// the evidence as a plain text segment instead.

import type { Evidence, RepoRef } from "@necro/oracle/client";

/**
 * Build the GitHub blob URL for an `Evidence` location, or `null` when the
 * evidence has no `path`.
 *
 * The result is
 * `https://github.com/{owner}/{name}/blob/{sha}/{encodedPath}` with each path
 * segment percent-encoded, plus a trailing `#L{line}` when `line` is a defined
 * integer.
 */
export function buildEvidenceLink(
  ref: Pick<RepoRef, "owner" | "name" | "sha">,
  evidence: Pick<Evidence, "path" | "line">,
): string | null {
  const { path } = evidence;
  if (path === undefined) return null;

  const encodedPath = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  const base = `https://github.com/${ref.owner}/${ref.name}/blob/${ref.sha}/${encodedPath}`;

  const { line } = evidence;
  return line !== undefined && Number.isInteger(line) ? `${base}#L${line}` : base;
}
