import { adjacency, mods, prod } from '../core/economy';
import { bridgeComponents, bridgeTouchSet } from '../core/bridge-relay';
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
}

const keyOf = (L: FlowLink) => `${L.from}>${L.to}:${L.kind}`;

function pushPair(out: FlowLink[], from: number, to: number, kind: FlowLinkKind, rate: number) {
  if (from === to) return;
  out.push({ from, to, kind, rate });
}

/** One smooth source→target arch per relationship. Never split into hop segments. */
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
  const springOut = config.tiles.spring.out * m.global;

  if (kind === 'mill') {
    for (const n of adj) {
      if (tiles[n] === 'spring') {
        const rate = perTile[n] > 0 ? perTile[n] : springOut;
        pushPair(out, n, focus, 'feed', rate);
      }
      if (tiles[n] === 'beacon') pushPair(out, n, focus, 'boost', 0);
    }
  }

  if (kind === 'spring') {
    for (const n of adj) {
      if (tiles[n] === 'mill') {
        const rate = perTile[focus] > 0 ? perTile[focus] : springOut;
        pushPair(out, focus, n, 'feed', rate);
      }
      if (tiles[n] === 'beacon') pushPair(out, n, focus, 'boost', 0);
    }
  }

  if (kind === 'beacon') {
    for (const n of adj) {
      const tn = tiles[n];
      if (tn === 'spring' || tn === 'mill') pushPair(out, focus, n, 'boost', 0);
    }
  }

  if (kind === 'bridge') {
    for (const comp of bridgeComponents(g, tiles)) {
      if (!comp.includes(focus)) continue;
      const touch = [...bridgeTouchSet(g, tiles, comp)];
      for (const n of touch) {
        if (n === focus) continue;
        const lk = tiles[n] === 'bridge' ? 'relay' : 'bridge';
        pushPair(out, focus, n, lk, 0);
      }
      for (const a of touch) {
        if (tiles[a] !== 'spring') continue;
        for (const b of touch) {
          if (tiles[b] !== 'mill') continue;
          const rate = perTile[a] > 0 ? perTile[a] : springOut;
          pushPair(out, a, b, 'feed', rate);
        }
      }
    }
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
