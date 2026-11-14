import { describe, expect, it } from 'vitest';
import Decimal from 'break_eternity.js';
import { GRAPHS, initialState } from '../src/core/state';
import { isActive, maxRing } from '../src/core/economy';
import { blueprintProgress, blueprintReserves, blueprintStep, clearBlueprint, saveBlueprint } from '../src/core/blueprint';
import { drift } from '../src/core/prestige';
import { simulate } from '../src/core/tick';
import { config } from '../src/core/config';
import type { TileType } from '../src/core/tiles';

/** A live state past the 1 Drift milestone, surveyed to the maximum ring. */
const live = () => {
  const s = initialState();
  s.drifts = 1;
  s.ring = maxRing(s);
  return s;
};

const activeIdx = (s: ReturnType<typeof live>) => GRAPHS[s.geometry].ring.map((_, i) => i).filter((i) => isActive(s, i));
const emptyBp = () => GRAPHS.square.ring.map((): TileType | null => null);

describe('blueprint save / clear / progress', () => {
  it('an empty board saves nothing', () => {
    const s = live();
    expect(saveBlueprint(s)).toBe(0);
    expect(s.blueprints.square).toBeNull();
  });

  it('saves the layout for this geometry only and reports the count', () => {
    const s = live();
    s.tiles[0] = 'mill';
    s.tiles[1] = 'spring';
    expect(saveBlueprint(s)).toBe(2);
    expect(s.blueprints.square).toEqual(s.tiles);
    expect(s.blueprints.hyper).toBeNull();
  });

  it('progress counts matching entries and clear removes the blueprint', () => {
    const s = live();
    s.tiles[0] = 'mill';
    s.tiles[1] = 'spring';
    saveBlueprint(s);
    s.tiles[1] = null;
    expect(blueprintProgress(s)).toEqual({ total: 2, placed: 1 });
    clearBlueprint(s);
    expect(s.blueprints.square).toBeNull();
    expect(blueprintProgress(s)).toEqual({ total: 0, placed: 0 });
  });
});

describe('blueprintStep', () => {
  it('places the cheapest type first, one tile per call, lowest index on ties', () => {
    const s = live();
    const [a, b] = activeIdx(s);
    const bp = emptyBp();
    bp[a] = 'mill';
    bp[b] = 'spring';
    s.blueprints.square = bp;
    s.ink = new Decimal(1e9);
    expect(blueprintStep(s)).toBe(b); // spring (10 Ink) is cheaper than mill (85)
    expect(s.tiles[b]).toBe('spring');
    expect(s.tiles[a]).toBeNull();
    expect(blueprintStep(s)).toBe(a);
    expect(blueprintStep(s)).toBeNull();
  });

  it('does nothing without Ink', () => {
    const s = live();
    const [a] = activeIdx(s);
    const bp = emptyBp();
    bp[a] = 'spring';
    s.blueprints.square = bp;
    s.ink = new Decimal(1);
    expect(blueprintStep(s)).toBeNull();
    expect(s.tiles[a]).toBeNull();
  });

  it('skips inactive cells', () => {
    const s = live();
    s.ring = 0;
    const far = GRAPHS.square.ring.findIndex((r) => r > 0);
    const bp = emptyBp();
    bp[far] = 'spring';
    s.blueprints.square = bp;
    s.ink = new Decimal(1e9);
    expect(blueprintStep(s)).toBeNull();
    expect(s.tiles[far]).toBeNull();
  });

  it('never replaces an occupied cell', () => {
    const s = live();
    const [a] = activeIdx(s);
    const bp = emptyBp();
    bp[a] = 'spring';
    s.blueprints.square = bp;
    s.tiles[a] = 'mill';
    s.ink = new Decimal(1e9);
    expect(blueprintStep(s)).toBeNull();
    expect(s.tiles[a]).toBe('mill');
  });
});

describe('blueprint rebuild after Drift', () => {
  it('rebuilds the whole active layout over repeated simulate calls', () => {
    const s = live();
    s.tiles = GRAPHS.square.ring.map((_, i) => (isActive(s, i) ? (i === 0 ? 'mill' : 'spring') : null));
    saveBlueprint(s);
    s.runInk = new Decimal(1e9);
    drift(s);
    expect(s.drifts).toBe(2);
    expect(s.tiles.every((t) => t === null)).toBe(true);
    s.ink = new Decimal(1e12);
    for (let k = 0; k < 2000; k++) simulate(s, 0.1);
    const bp = s.blueprints.square!;
    const wanted = activeIdx(s).filter((i) => bp[i] !== null);
    expect(wanted.length).toBeGreaterThan(1);
    for (const i of wanted) expect(s.tiles[i]).toBe(bp[i]);
  });

  it('with autoBuild off nothing is placed', () => {
    const s = live();
    s.tiles[0] = 'mill';
    saveBlueprint(s);
    s.runInk = new Decimal(1e9);
    drift(s);
    s.autoBuild = false;
    s.ink = new Decimal(1e12);
    for (let k = 0; k < 200; k++) simulate(s, 0.1);
    expect(s.tiles.every((t) => t === null)).toBe(true);
  });

  it('auto-Springs leave a cell reserved for a Mill', () => {
    const s = live();
    s.ring = 1;
    const cell = activeIdx(s)[0];
    const bp = emptyBp();
    bp[cell] = 'mill';
    s.blueprints.square = bp;
    s.chartUpg.autoSprings = 1;
    s.autoSpringTimer = config.autoSpringInterval;
    // Too little Ink for a Mill (85), enough for a Spring (10): the blueprint waits and Well Diggers must not fill its cell.
    s.ink = new Decimal(20);
    expect(blueprintReserves(s, cell)).toBe(true);
    simulate(s, 0.1);
    expect(s.tiles[cell]).toBeNull();
    expect(s.tiles.some((t) => t === 'spring')).toBe(true);
  });
});
