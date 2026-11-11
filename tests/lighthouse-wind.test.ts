import { describe, expect, it } from 'vitest';
import { config } from '../src/core/config';
import { GRAPHS, initialState, type GameState } from '../src/core/state';
import { catchWind, mods, production, ring2 } from '../src/core/economy';
import { simulate } from '../src/core/tick';
import { migrations } from '../src/core/save';
import type { TileType } from '../src/core/tiles';

describe('lighthouse', () => {
  // A Lighthouse at the centre boosts producers exactly two steps away, and nothing closer.
  const layout = (geo: 'square' | 'hyper') => {
    const g = GRAPHS[geo];
    const tiles: (TileType | null)[] = g.ring.map(() => null);
    const far = ring2(g, 0)[0];
    tiles[0] = 'lighthouse';
    tiles[far] = 'spring';
    return { g, tiles, far };
  };
  const m = mods(initialState());
  for (const geo of ['square', 'hyper'] as const) {
    it(`boosts a producer two steps away on the ${geo} board`, () => {
      const { g, tiles } = layout(geo);
      const base = production(g, tiles.map((t, i) => (i === 0 ? null : t)), m).total;
      const boosted = production(g, tiles, m).total;
      expect(boosted).toBeCloseTo(base * config.tiles.lighthouse.mult, 6);
    });
  }

  it('does not boost a producer one step away', () => {
    const g = GRAPHS.hyper;
    const tiles: (TileType | null)[] = g.ring.map(() => null);
    const near = g.neighbours[0][0];
    tiles[0] = 'lighthouse';
    tiles[near] = 'spring';
    const withLh = production(g, tiles, m).total;
    tiles[0] = null;
    const without = production(g, tiles, m).total;
    expect(withLh).toBeCloseTo(without, 6);
  });
});

describe('trade wind', () => {
  it('catching pays at least minInk and starts a surge', () => {
    const s: GameState = initialState();
    const before = s.ink;
    const gain = catchWind(s);
    expect(gain.gte(config.wind.minInk)).toBe(true);
    expect(s.ink.sub(before).eq(gain)).toBe(true);
    expect(s.surge).toBe(config.wind.surgeSec);
    expect(s.windsCaught).toBe(1);
  });

  it('the surge multiplies live output and expires', () => {
    const surged: GameState = initialState();
    const calm: GameState = initialState();
    surged.tiles[0] = 'spring';
    calm.tiles[0] = 'spring';
    catchWind(surged); // the catch itself pays Ink; measure only the per-second gain after it
    const inkBefore = surged.ink;
    const calmBefore = calm.ink;
    simulate(surged, 1);
    simulate(calm, 1);
    const surgeGain = surged.ink.sub(inkBefore).toNumber();
    const calmGain = calm.ink.sub(calmBefore).toNumber();
    expect(calmGain).toBeGreaterThan(0);
    expect(surgeGain).toBeCloseTo(calmGain * config.wind.surgeMult, 6);
    expect(surged.surge).toBe(config.wind.surgeSec - 1);
  });

  it('offline progress ignores an active surge', () => {
    const s: GameState = initialState();
    s.tiles[0] = 'spring';
    s.surge = 10;
    simulate(s, 1, 1, true);
    expect(s.surge).toBe(0);
  });
});

describe('save v2 -> v3 migration', () => {
  it('adds surge and windsCaught as zero', () => {
    const v2 = { ink: '1', tiles: [] } as Record<string, unknown>;
    const v3 = migrations[2](v2);
    expect(v3.surge).toBe(0);
    expect(v3.windsCaught).toBe(0);
    expect(v3.ink).toBe('1');
  });
});
