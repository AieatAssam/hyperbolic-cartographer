import type { FlowLink } from './flow-links';

/** Optional per-frame board emphasis (placement preview, inspect fade). Pure data; consumed by Board.update. */
export interface BoardHighlight {
  /** Neighbour outlines (solid adj colour). */
  direct?: readonly number[];
  /** Bridge-relay outlines (gold / pulse). */
  bridge?: readonly number[];
  /** Cells kept at full colour while dimming the rest (inspect). */
  lit?: readonly number[];
  /** 0 = normal board, 1 = full grey-out for unlit cells. */
  dim?: number;
  /** 0..1 animation phase for bridge pulse. */
  pulse?: number;
  /** Optional bridge preview arc between two tile indices. */
  arc?: readonly [number, number];
  /** Active constellation edges (gold lines on the board). */
  constellation?: readonly [number, number][];
  /** Burst intensity 0..1 (decays after complete). */
  constellationPulse?: number;
  /** Permanent faint links after a pattern completes. */
  constellationPermanent?: readonly [number, number][];
  /** Dashed ghost hint for a pattern that would complete on place. */
  constellationGhost?: readonly [number, number][];
  /** Animated inspect ink-flow arches. */
  flowLinks?: FlowLink[];
  /** 0..1 dash phase for flow animation. */
  flowPhase?: number;
}
