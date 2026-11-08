import { adjacency, mods, prod } from '../core/economy';
import { bridgePath } from './fx-graph';
import type { TileGraph } from '../core/geometry/graph';
import { graphOf, type GameState } from '../core/state';
import type { TileType } from '../core/tiles';

export type FlowLinkKind = 'feed' | 'boost' | 'bridge' | 'relay';

export interface FlowLink {
  from: number;
  to: number;
  kind: FlowLinkKind;
  rate: number;
  path?: readonly number[];
}

const keyOf = (L: FlowLink) => `${L.kind}|${Math.min(L.from, L.to)}:${Math.max(L.from, L.to)}`;

function pushPath(out: FlowLink[], path: readonly number[], kind: FlowLinkKind, rate: number) {
  for (let k = 0; k + 1 < path.length; k++) {
    out.push({
      from: path[k], to: path[k + 1], kind, rate: k === path.length - 2 ? rate : 0, path,
    });
  }
}

function connect(
  out: FlowLink[],
  g: TileGraph,
  tiles: (TileType | null)[],
  from: number,
  to: number,
  kind: FlowLinkKind,
  reach: number,
  rate = 0,
) {
  if (from === to) return;
  const path = bridgePath(g, tiles, from, to, reach);
  if (path && path.length > 2 && kind !== 'bridge') pushPath(out, path, kind === 'feed' ? 'relay' : kind, rate);
  else out.push({ from, to, kind, rate, path: path ?? undefined });
}

/** Flow edges to draw when inspecting tile `focus`. */
export function flowLinksForTile(
  g: TileGraph,
  tiles: (TileType | null)[],
  focus: number,
  reach: number,
  perTile: number[],
): FlowLink[] {
  if (focus < 0 || !tiles[focus]) return [];
  const kind = tiles[focus]!;
  const out: FlowLink[] = [];
  const adj = adjacency(g, tiles, focus, reach);

  if (kind === 'mill' || kind === 'spring') {
    for (const n of adj) {
      const tn = tiles[n];
      if (kind === 'mill' && tn === 'spring') connect(out, g, tiles, n, focus, 'feed', reach, perTile[n] ?? 0);
      if (kind === 'spring' && tn === 'mill') connect(out, g, tiles, focus, n, 'feed', reach, perTile[focus] ?? 0);
      if (tn === 'beacon') connect(out, g, tiles, n, focus, 'boost', reach);
    }
    for (const n of adj) {
      if (tiles[n] !== 'beacon') continue;
      for (const v of adjacency(g, tiles, n, reach)) {
        if (v === focus) continue;
        const tv = tiles[v];
        if (tv === 'spring' || tv === 'mill') connect(out, g, tiles, n, v, 'boost', reach);
      }
    }
    for (const n of adj) {
      if (g.neighbours[focus].includes(n)) continue;
      if (!tiles[n]) continue;
      const path = bridgePath(g, tiles, focus, n, reach);
      if (path?.some((p) => p !== focus && p !== n && tiles[p] === 'bridge')) {
        connect(out, g, tiles, focus, n, 'relay', reach, perTile[n] ?? 0);
      }
    }
  }

  if (kind === 'beacon') {
    for (const n of adj) {
      const tn = tiles[n];
      if (tn === 'spring' || tn === 'mill') connect(out, g, tiles, focus, n, 'boost', reach);
    }
  }

  if (kind === 'bridge') {
    const occ = g.neighbours[focus].filter((n) => tiles[n]);
    for (let i = 0; i < occ.length; i++)
      for (let j = i + 1; j < occ.length; j++) connect(out, g, tiles, occ[i], occ[j], 'bridge', reach);
    for (const n of occ) connect(out, g, tiles, focus, n, 'relay', reach);
  }

  const seen = new Set<string>();
  return out.filter((L) => {
    const k = keyOf(L);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function flowLinksForState(s: GameState, focus: number): FlowLink[] {
  const g = graphOf(s);
  const reach = mods(s).reach;
  return flowLinksForTile(g, s.tiles, focus, reach, prod(s).perTile);
}
