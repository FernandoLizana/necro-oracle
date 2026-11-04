// apps/web/src/server/pinned-ref.ts
//
// Server-owned copy of the canonical Pinned_Reference formatter (design
// "Module layout" / "Handler pipeline"). Only the server may pair this with
// `@necro/github`'s `parseRepoRef` for the round-trip proven by Property 18;
// the client ui-crt copy cannot import `@necro/github`.
//
// `formatPinnedRef(ref)` renders a RepoRef into the `owner/name@sha` shorthand
// that `parseRepoRef` accepts. The `defaultBranch` field is intentionally
// ignored — a pinned reference identifies an exact commit, not a branch.
//
// _Requirements: R5.3, R6.1, R6.4_

import type { RepoRef } from "@necro/oracle/client";

/** Format a RepoRef as the canonical pinned reference `owner/name@sha`. */
export function formatPinnedRef(ref: Pick<RepoRef, "owner" | "name" | "sha"> | RepoRef): string {
  return `${ref.owner}/${ref.name}@${ref.sha}`;
}
