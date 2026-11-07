import { adjacency, mods } from './economy';
import type { TileGraph } from './geometry/graph';
import { graphOf, type GameState } from './state';
import type { TileType } from './tiles';

export interface PlacementImpact {
  /** Graph neighbours of the placement cell. */
  direct: number[];
  /** Cells reached only through bridge hops from the placement (excludes direct). */
  viaBridge: number[];
  /** All cells whose production would change if `type` is placed at `i` (preview). */
  production: number[];
}

function hypotheticalTile(tiles: (TileType | null)[], i: number, type: TileType | null) {
  const next = tiles.slice();
  next[i] = type;
  return next;
}

/** Cells affected when placing `type` at empty active cell `i`. */
export function placementImpact(
  g: TileGraph,
  tiles: (TileType | null)[],
  i: number,
  type: TileType,
  reach: number,
): PlacementImpact {
  const direct = [...g.neighbours[i]];
  const hyp = hypotheticalTile(tiles, i, type);
  const extended = new Set(adjacency(g, hyp, i, reach));
  direct.forEach((d) => extended.delete(d));
  extended.delete(i);
  const viaBridge = [...extended];
  const production = new Set<number>([i, ...direct, ...viaBridge]);
  for (let j = 0; j < tiles.length; j++) {
    const t = tiles[j];
    if (!t || (t !== 'spring' && t !== 'mill' && t !== 'beacon')) continue;
    const adj = adjacency(g, hyp, j, reach);
    if (adj.includes(i) || viaBridge.includes(j) || direct.includes(j)) {
      production.add(j);
      adj.forEach((n) => production.add(n));
    }
  }
  return { direct, viaBridge, production: [...production] };
}

/** Bidirectional influence set for inspecting an occupied tile at `i`. */
export function tileInfluenceSet(
  g: TileGraph,
  tiles: (TileType | null)[],
  i: number,
  reach: number,
): number[] {
  const lit = new Set<number>([i]);
  const adj = adjacency(g, tiles, i, reach);
  adj.forEach((n) => lit.add(n));
  for (let j = 0; j < tiles.length; j++) {
    if (!tiles[j]) continue;
    if (adjacency(g, tiles, j, reach).includes(i)) lit.add(j);
  }
  return [...lit];
}

export function placementImpactState(s: GameState, i: number, type: TileType): PlacementImpact {
  const g = graphOf(s);
  return placementImpact(g, s.tiles, i, type, mods(s).reach);
}

export function tileInfluenceState(s: GameState, i: number): number[] {
  return tileInfluenceSet(graphOf(s), s.tiles, i, mods(s).reach);
}
