import { describe, expect, it } from 'vitest';
import { mods } from '../src/core/economy';
import { graphOf, initialState } from '../src/core/state';
import type { TileType } from '../src/core/tiles';
import { flowLinksForTile } from '../src/render/flow-links';

describe('flowLinksForTile', () => {
  it('connects spring to mill with a feed link', () => {
    const s = initialState();
    const g = graphOf(s);
    const m = mods(s);
    const tiles: (TileType | null)[] = g.ring.map(() => null);
    const spring = 0;
    const mill = g.neighbours[spring][0];
    tiles[spring] = 'spring';
    tiles[mill] = 'mill';
    const links = flowLinksForTile(g, tiles, mill, m.reach, [1, 2], m);
    expect(links.some((L) => L.kind === 'feed' && L.from === spring && L.to === mill)).toBe(true);
  });

  it('shows bridge links between occupied neighbours of a bridge', () => {
    const s = initialState();
    const g = graphOf(s);
    const m = mods(s);
    const tiles: (TileType | null)[] = g.ring.map(() => null);
    const bridge = 0;
    const a = g.neighbours[bridge][0];
    const b = g.neighbours[bridge][1];
    tiles[bridge] = 'bridge';
    tiles[a] = 'spring';
    tiles[b] = 'mill';
    const links = flowLinksForTile(g, tiles, bridge, m.reach, [0, 0, 0], m);
    expect(links.some((L) => (L.kind === 'bridge' || L.kind === 'relay') && (L.from === a || L.from === b || L.to === a || L.to === b))).toBe(true);
  });
});
