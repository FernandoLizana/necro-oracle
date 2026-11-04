// src/components/EvidenceScroll.tsx
//
// Feature: 03-crt-terminal, task 17.2.
//
// Renders the explain evidence list for a single card: the full-fidelity
// evidence the pure `renderExplain` produced as `OutputBlock`s. Evidence paths
// become the only clickable Evidence_Links (live readings only), opened safely
// via `OutputBlockView`. It parses no repository text; it consumes
// `OutputBlock` data only.
//
// _Requirements: R8.1, R8.2, R8.3, R14.1, R14.5, R15.11_

import type { OutputBlock } from "../render/blocks.js";
import { OutputBlockView } from "./OutputBlockView.js";

/** Props for the explain evidence list. */
export interface EvidenceScrollProps {
  /** The explain blocks produced by `renderExplain`. */
  readonly blocks: readonly OutputBlock[];
}

/** Render the explain evidence blocks. */
export function EvidenceScroll({ blocks }: EvidenceScrollProps): React.JSX.Element {
  return (
    <div className="crt-evidence">
      {blocks.map((block) => (
        <OutputBlockView key={block.id} block={block} revealedCount={null} />
      ))}
    </div>
  );
}
