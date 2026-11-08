import { describe, expect, it } from 'vitest';
import { graphOf, initialState } from '../src/core/state';
import { flowLinksForTile } from '../src/render/flow-links';

describe('flowLinksForTile', () => {
  it('connects spring to mill with a feed link', () => {
    const s = initialState();
    const g = graphOf(s);
    const tiles = g.ring.map(() => null);
    const spring = 0;
    const mill = g.neighbours[spring][0];
    tiles[spring] = 'spring';
    tiles[mill] = 'mill';
    const links = flowLinksForTile(g, tiles, mill, 1, [1, 2]);
    expect(links.some((L) => L.kind === 'feed' && L.from === spring && L.to === mill)).toBe(true);
  });

  it('shows bridge links between occupied neighbours of a bridge', () => {
    const s = initialState();
    const g = graphOf(s);
    const tiles = g.ring.map(() => null);
    const bridge = 0;
    const a = g.neighbours[bridge][0];
    const b = g.neighbours[bridge][1];
    tiles[bridge] = 'bridge';
    tiles[a] = 'spring';
    tiles[b] = 'mill';
    const links = flowLinksForTile(g, tiles, bridge, 1, [0, 0, 0]);
    expect(links.some((L) => L.kind === 'bridge' && (L.from === a || L.from === b))).toBe(true);
  });
});
