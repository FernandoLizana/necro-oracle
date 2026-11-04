// src/components/Card.tsx
//
// Feature: 03-crt-terminal, task 17.2.
//
// Renders a single spread-position card as an `OutputBlock`. `Card` is a thin
// wrapper over `OutputBlockView`: the position was already turned into block
// data by `renderCardBlock` (the pure renderer), so this component only decides
// presentation. It is reused by the explain view for a single position. It
// parses no repository text — it consumes `OutputBlock` data only.
//
// _Requirements: R14.1, R14.5, R15.11_

import type { OutputBlock } from "../render/blocks.js";
import { OutputBlockView } from "./OutputBlockView.js";

/** Props for a single card block. */
export interface CardProps {
  /** The pre-rendered card/position block. */
  readonly block: OutputBlock;
  /** Revealed-character count, or `null` when the card is not animating. */
  readonly revealedCount?: number | null;
}

/** Render one card/position block. */
export function Card({ block, revealedCount = null }: CardProps): React.JSX.Element {
  return <OutputBlockView block={block} revealedCount={revealedCount} />;
}
