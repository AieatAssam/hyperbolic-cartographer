import { adjacency, mods, prod } from '../core/economy';
import { bridgeComponents, bridgeTouchSet } from '../core/bridge-relay';
import { bridgePath } from './fx-graph';
import { config } from '../core/config';
import type { TileGraph } from '../core/geometry/graph';
import { graphOf, type GameState } from '../core/state';
import type { TileType } from '../core/tiles';

export type FlowLinkKind = 'feed' | 'boost' | 'bridge' | 'relay' | 'penalty';

export interface FlowLink {
  from: number;
  to: number;
  kind: FlowLinkKind;
  /** Ink/s carried or delta sign for labels (0 = omit). */
  rate: number;
  path?: readonly number[];
}

const keyOf = (L: FlowLink) => `${L.from}>${L.to}:${L.kind}`;

function pushPath(out: FlowLink[], path: readonly number[], kind: FlowLinkKind, rate: number) {
  for (let k = 0; k + 1 < path.length; k++) {
    out.push({ from: path[k], to: path[k + 1], kind: k === path.length - 2 ? kind : 'relay', rate: k === path.length - 2 ? rate : 0 });
  }
}

function linkPath(
  out: FlowLink[],
  g: TileGraph,
  tiles: (TileType | null)[],
  from: number,
  to: number,
  kind: FlowLinkKind,
  reach: number,
  rate: number,
) {
  if (from === to) return;
  const path = bridgePath(g, tiles, from, to, reach);
  if (path && path.length > 2) pushPath(out, path, kind, rate);
  else out.push({ from, to, kind, rate, path: path ?? undefined });
}

function millFeedRate(m: ReturnType<typeof mods>): number {
  return config.tiles.spring.out * m.global;
}

/** All inspect flow edges for tile `focus`. */
export function flowLinksForTile(
  g: TileGraph,
  tiles: (TileType | null)[],
  focus: number,
  reach: number,
  perTile: number[],
  m: ReturnType<typeof mods>,
): FlowLink[] {
  if (focus < 0 || !tiles[focus]) return [];
  const kind = tiles[focus]!;
  const out: FlowLink[] = [];
  const adj = adjacency(g, tiles, focus, reach);

  if (kind === 'mill') {
    for (const n of adj) {
      if (tiles[n] === 'spring') {
        const rate = perTile[focus] > 0 ? perTile[n] ?? millFeedRate(m) : millFeedRate(m);
        linkPath(out, g, tiles, n, focus, 'feed', reach, rate);
      }
      if (tiles[n] === 'beacon') linkPath(out, g, tiles, n, focus, 'boost', reach, 0);
    }
    for (const n of adj) {
      if (tiles[n] !== 'beacon') continue;
      for (const v of adjacency(g, tiles, n, reach)) {
        if (v === focus) continue;
        linkPath(out, g, tiles, n, v, 'boost', reach, 0);
      }
    }
  }

  if (kind === 'spring') {
    for (const n of adj) {
      if (tiles[n] === 'mill') linkPath(out, g, tiles, focus, n, 'feed', reach, perTile[focus] ?? config.tiles.spring.out);
      if (tiles[n] === 'beacon') linkPath(out, g, tiles, n, focus, 'boost', reach, 0);
    }
    for (const n of adj) {
      if (tiles[n] !== 'beacon') continue;
      for (const v of adjacency(g, tiles, n, reach)) {
        if (v === focus) continue;
        linkPath(out, g, tiles, n, v, 'boost', reach, 0);
      }
    }
  }

  if (kind === 'beacon') {
    for (const n of adj) {
      const tn = tiles[n];
      if (tn === 'spring' || tn === 'mill') linkPath(out, g, tiles, focus, n, 'boost', reach, 0);
    }
  }

  if (kind === 'bridge') {
    for (const comp of bridgeComponents(g, tiles)) {
      if (!comp.includes(focus)) continue;
      const touch = [...bridgeTouchSet(g, tiles, comp)];
      for (let i = 0; i < touch.length; i++) {
        for (let j = i + 1; j < touch.length; j++) {
          const a = touch[i], b = touch[j];
          if (tiles[a] === 'bridge' && tiles[b] === 'bridge') continue;
          const lk = tiles[a] === 'bridge' || tiles[b] === 'bridge' ? 'bridge' : 'relay';
          linkPath(out, g, tiles, a, b, lk, reach, 0);
        }
      }
      for (const n of touch) {
        if (n !== focus) linkPath(out, g, tiles, focus, n, 'relay', reach, 0);
      }
    }
  }

  if (kind === 'vault') {
    for (const n of adj) linkPath(out, g, tiles, focus, n, 'relay', reach, 0);
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
  const m = mods(s);
  return flowLinksForTile(g, s.tiles, focus, m.reach, prod(s).perTile, m);
}
