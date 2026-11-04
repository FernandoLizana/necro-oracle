// @necro/ui-crt — pinned-reference helper (pure, client-safe).
//
// `formatPinnedRef` builds the canonical Pinned_Reference string
// `owner/name@<sha>` from the RepoRef the summon step pins. The sha is the
// 40-hex lowercase commit id already resolved server-side; this helper simply
// joins owner, name and sha and never consults `defaultBranch` (R5.3, R6.1).
//
// The same one-line function also lives server-side
// (`apps/web/src/server/pinned-ref.ts`), where its round trip through
// `parseRepoRef` is proved by Property 18. Importing RepoRef only through the
// Client_Safe_Entry subpath `@necro/oracle/client` keeps this browser-safe.
//
// _Requirements: R5.3, R6.1_

import type { RepoRef } from "@necro/oracle/client";

/**
 * Build the Pinned_Reference `owner/name@<sha>` from a RepoRef.
 *
 * Only `owner`, `name` and `sha` are read; `defaultBranch` is ignored.
 */
export function formatPinnedRef(
  ref: Pick<RepoRef, "owner" | "name" | "sha"> | RepoRef,
): string {
  return `${ref.owner}/${ref.name}@${ref.sha}`;
}
