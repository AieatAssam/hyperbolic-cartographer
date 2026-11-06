import type { TileGraph } from './graph';

export interface SquareBoard extends TileGraph {
  /** grid coords per node */
  xy: [number, number][];
}

/** Square grid of Chebyshev radius `radius`, nodes sorted by ring so ring-prefix ids are stable. */
export function squareGraph(radius: number): SquareBoard {
  const cells: [number, number][] = [];
  for (let y = -radius; y <= radius; y++) for (let x = -radius; x <= radius; x++) cells.push([x, y]);
  const ringOf = ([x, y]: [number, number]) => Math.max(Math.abs(x), Math.abs(y));
  cells.sort((a, b) => ringOf(a) - ringOf(b) || Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]));
  const index = new Map(cells.map((c, i) => [c.join(','), i]));
  const neighbours = cells.map(([x, y]) =>
    [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .map(([dx, dy]) => index.get(`${x + dx},${y + dy}`))
      .filter((n): n is number => n !== undefined),
  );
  return { ring: cells.map(ringOf), neighbours, xy: cells };
}
