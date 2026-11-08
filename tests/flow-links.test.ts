import { describe, expect, it } from 'vitest';
import { mods } from '../src/core/economy';
import { squareGraph } from '../src/core/geometry/square';
import { graphOf, initialState } from '../src/core/state';
import type { TileType } from '../src/core/tiles';
import { flowLinksForTile } from '../src/render/flow-links';

describe('flowLinksForTile', () => {
  it('connects spring to mill with a single feed arch', () => {
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
    expect(links.every((L) => L.from === spring || L.from === mill || tiles[L.from] === 'beacon')).toBe(true);
  });

  it('shows one arch from a selected bridge to each connected tile', () => {
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
    expect(links.some((L) => L.kind === 'bridge' && L.from === bridge && (L.to === a || L.to === b))).toBe(true);
  });

  it('does not split a two-bridge chain into hop segments', () => {
    const g = squareGraph(1);
    const m = { global: 1, beacon: 1.5, beaconPerDegree: 0, reach: 1 };
    const tiles: (TileType | null)[] = g.ring.map(() => null);
    const by = (x: number, y: number) => g.xy.findIndex(([a, b]) => a === x && b === y);
    const spring = by(-1, 0);
    const mill = by(1, -1);
    tiles[by(-1, -1)] = 'bridge';
    tiles[by(0, -1)] = 'bridge';
    tiles[spring] = 'spring';
    tiles[mill] = 'mill';
    const links = flowLinksForTile(g, tiles, mill, 1, tiles.map(() => 1), m);
    const feeds = links.filter((L) => L.kind === 'feed');
    expect(feeds.some((L) => L.from === spring && L.to === mill)).toBe(true);
    expect(feeds.every((L) => tiles[L.from] === 'spring' && tiles[L.to] === 'mill')).toBe(true);
  });
});
