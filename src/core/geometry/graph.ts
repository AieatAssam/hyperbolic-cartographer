/** Geometry-agnostic board graph. Core logic only ever sees this. */
export interface TileGraph {
  /** ring (shell) index per node. Not graph distance: square rings are Chebyshev radius, so walk `neighbours` for graph distance */
  ring: number[];
  /** neighbour node indices per node (symmetric) */
  neighbours: number[][];
}

export function ringCounts(g: TileGraph): number[] {
  const out: number[] = [];
  for (const r of g.ring) out[r] = (out[r] ?? 0) + 1;
  return out;
}
