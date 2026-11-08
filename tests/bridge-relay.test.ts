import { describe, expect, it } from 'vitest';
import { adjacency, production } from '../src/core/economy';
import { squareGraph } from '../src/core/geometry/square';
import type { TileType } from '../src/core/tiles';
import { bridgeComponents, bridgeTouchSet } from '../src/core/bridge-relay';

const m = { global: 1, beacon: 1.5, beaconPerDegree: 0, reach: 1 };

describe('bridge relay chain', () => {
  it('touch set links every tile along a two-bridge chain', () => {
    const g = squareGraph(1);
    const tiles: (TileType | null)[] = g.ring.map(() => null);
    const by = (x: number, y: number) => g.xy.findIndex(([a, b]) => a === x && b === y);
    tiles[by(-1, -1)] = 'bridge';
    tiles[by(0, -1)] = 'bridge';
    tiles[by(-1, 0)] = 'spring';
    tiles[by(1, -1)] = 'mill';
    const comp = bridgeComponents(g, tiles)[0];
    const touch = bridgeTouchSet(g, tiles, comp);
    expect(touch.has(by(-1, 0))).toBe(true);
    expect(touch.has(by(1, -1))).toBe(true);
    expect(adjacency(g, tiles, by(-1, 0), m.reach).includes(by(1, -1))).toBe(true);
  });

  it('feeds a bottom-right mill through two bridges at default reach', () => {
    const g = squareGraph(1);
    const tiles: (TileType | null)[] = g.ring.map(() => null);
    const by = (x: number, y: number) => g.xy.findIndex(([a, b]) => a === x && b === y);
    tiles[by(-1, -1)] = 'bridge';
    tiles[by(0, -1)] = 'bridge';
    tiles[by(-1, 0)] = 'spring';
    tiles[by(1, -1)] = 'mill';
    const p = production(g, tiles, m);
    const mill = by(1, -1);
    const spring = by(-1, 0);
    expect(p.perTile[mill]).toBeGreaterThan(0);
    expect(p.perTile[spring]).toBeGreaterThan(0);
    expect(p.perTile[mill]).toBeGreaterThan(p.perTile[spring] * 0.5);
  });
});
