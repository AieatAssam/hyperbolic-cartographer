import { describe, expect, it } from 'vitest';
import { config } from '../src/core/config';
import { GRAPHS, initialState, type GameState } from '../src/core/state';
import { catchWind, inkPerSec, mods, production, prod, ring2 } from '../src/core/economy';
import { simulate } from '../src/core/tick';
import { migrations } from '../src/core/save';
import { pickWindKind } from '../src/core/wind';
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
  const withSpring = (): GameState => {
    const s: GameState = initialState();
    s.tiles[0] = 'spring';
    return s;
  };
  const K = config.wind.kinds;

  it('picks kinds by weight from one rand() call', () => {
    expect(pickWindKind(() => 0.0)).toBe('trade');
    expect(pickWindKind(() => 0.74)).toBe('trade');
    expect(pickWindKind(() => 0.76)).toBe('gale');
    expect(pickWindKind(() => 0.96)).toBe('monsoon');
  });

  it('a Trade Wind pays at least minInk and starts its surge', () => {
    const s: GameState = initialState();
    const before = s.ink;
    const gain = catchWind(s, 'trade');
    expect(gain.gte(config.wind.minInk)).toBe(true);
    expect(s.ink.sub(before).eq(gain)).toBe(true);
    expect(s.surge).toBe(K.trade.surgeSec);
    expect(s.surgeMult).toBe(K.trade.surgeMult);
    expect(s.windsCaught).toBe(1);
  });

  it('a Gale sets a x7 surge', () => {
    const s = withSpring();
    catchWind(s, 'gale');
    expect(s.surge).toBe(K.gale.surgeSec);
    expect(s.surgeMult).toBe(7);
  });

  it('a Monsoon pays a long burst and leaves the surge untouched', () => {
    const s = withSpring();
    const expected = Math.max(prod(s).total * K.monsoon.burstSec, config.wind.minInk);
    const gain = catchWind(s, 'monsoon');
    expect(gain.toNumber()).toBeCloseTo(expected, 6);
    expect(s.surge).toBe(0);
    expect(s.windsCaught).toBe(1);
  });

  it('the surge multiplies live output and expires', () => {
    const surged = withSpring();
    const calm = withSpring();
    catchWind(surged, 'trade'); // the catch itself pays Ink; measure only the per-second gain after it
    const inkBefore = surged.ink;
    const calmBefore = calm.ink;
    simulate(surged, 1);
    simulate(calm, 1);
    const surgeGain = surged.ink.sub(inkBefore).toNumber();
    const calmGain = calm.ink.sub(calmBefore).toNumber();
    expect(calmGain).toBeGreaterThan(0);
    expect(surgeGain).toBeCloseTo(calmGain * K.trade.surgeMult, 6);
    expect(surged.surge).toBe(K.trade.surgeSec - 1);
  });

  it('inkPerSec uses the running surgeMult', () => {
    const s = withSpring();
    s.surge = 5;
    s.surgeMult = 4;
    expect(inkPerSec(s)).toBeCloseTo(prod(s).total * 4, 6);
    s.surge = 0;
    expect(inkPerSec(s)).toBeCloseTo(prod(s).total, 6);
  });

  it('offline progress ignores an active surge', () => {
    const s = withSpring();
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
