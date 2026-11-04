// src/components/Spread.tsx
//
// Feature: 03-crt-terminal, task 17.2.
//
// Renders the ordered position blocks of a fates or necropsy reading. The
// blocks are already produced in spread order by `renderReading`, so `Spread`
// only lays them out through `Card`. It is the positional layout the tarot UX
// calls for — information organised by card position, never a generic list. It
// parses no repository text; it consumes `OutputBlock` data only.
//
// _Requirements: R7.1, R15.11_

import type { OutputBlock } from "../render/blocks.js";
import { Card } from "./Card.js";

/** Props for a rendered spread. */
export interface SpreadProps {
  /** The ordered position blocks of a reading. */
  readonly blocks: readonly OutputBlock[];
}

/** Render the ordered position blocks of a spread. */
export function Spread({ blocks }: SpreadProps): React.JSX.Element {
  return (
    <div className="crt-spread">
      {blocks.map((block) => (
        <Card key={block.id} block={block} />
      ))}
    </div>
  );
}
