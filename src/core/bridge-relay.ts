import type { TileGraph } from './geometry/graph';
import type { TileType } from './tiles';

/** Connected components among placed bridge tiles. */
export function bridgeComponents(g: TileGraph, tiles: (TileType | null)[]): number[][] {
  const seen = new Set<number>();
  const out: number[][] = [];
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] !== 'bridge' || seen.has(i)) continue;
    const comp: number[] = [];
    const q = [i];
    seen.add(i);
    while (q.length) {
      const b = q.pop()!;
      comp.push(b);
      for (const n of g.neighbours[b]) {
        if (tiles[n] === 'bridge' && !seen.has(n)) {
          seen.add(n);
          q.push(n);
        }
      }
    }
    out.push(comp);
  }
  return out;
}

/** Every occupied tile graph-adjacent to any bridge in `component` (the relay footprint). */
export function bridgeTouchSet(
  g: TileGraph,
  tiles: (TileType | null)[],
  component: readonly number[],
): Set<number> {
  const s = new Set<number>(component);
  for (const b of component)
    for (const n of g.neighbours[b])
      if (tiles[n]) s.add(n);
  return s;
}

/** Tiles linked to a bridge component, plus `extraHops` further along bridge-only chains (Long Bridges). */
export function bridgeTouchSetExtended(
  g: TileGraph,
  tiles: (TileType | null)[],
  component: readonly number[],
  extraHops: number,
): Set<number> {
  let bridges = new Set(component);
  let touch = bridgeTouchSet(g, tiles, component);
  let frontier = [...component];
  for (let hop = 0; hop < extraHops; hop++) {
    const next: number[] = [];
    for (const b of frontier) {
      for (const n of g.neighbours[b]) {
        if (tiles[n] === 'bridge' && !bridges.has(n)) {
          bridges.add(n);
          next.push(n);
        }
      }
    }
    for (const b of next) for (const n of g.neighbours[b]) if (tiles[n]) touch.add(n);
    frontier = next;
    for (const b of next) touch.add(b);
  }
  return touch;
}

/** A spring or mill is in a bridge relay cluster. */
export function bridgeTouchCluster(
  g: TileGraph,
  tiles: (TileType | null)[],
): { components: number[][]; touchByComp: Set<number>[] } {
  const components = bridgeComponents(g, tiles);
  const touchByComp = components.map((c) => bridgeTouchSet(g, tiles, c));
  return { components, touchByComp };
}
