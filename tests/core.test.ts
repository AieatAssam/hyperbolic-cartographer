import { describe, expect, it } from 'vitest';
import Decimal from 'break_eternity.js';
import { config } from '../src/core/config';
import { GRAPHS, initialState } from '../src/core/state';
import { mods, production } from '../src/core/economy';
import { applyOffline } from '../src/core/tick';
import { exportString, importSave, makeSave, toJson } from '../src/core/save';
import { drift, project } from '../src/core/prestige';
import type { TileType } from '../src/core/tiles';

describe('production', () => {
  // Same layout logic on both boards: Mill in the centre, Springs on every neighbour, a Beacon beside it.
  const layout = (geo: 'square' | 'hyper') => {
    const g = GRAPHS[geo];
    const tiles: (TileType | null)[] = g.ring.map(() => null);
    tiles[0] = 'mill';
    for (const n of g.neighbours[0]) tiles[n] = 'spring';
    return { g, tiles };
  };
  const m = mods(initialState());
  it('hyperbolic gives a bigger jump for the same layout', () => {
    const sq = layout('square'), hy = layout('hyper');
    const ps = production(sq.g, sq.tiles, m).total, ph = production(hy.g, hy.tiles, m).total;
    const M = config.tiles.mill.out;
    const S = config.tiles.spring.out;
    expect(ps).toBeCloseTo(M * 5 + 4 * S);
    expect(ph).toBeCloseTo(M * 8 + 7 * S);
    expect(ph).toBeGreaterThan(ps * 1.5);
  });
  it('beacon multiplies, bridge propagates adjacency', () => {
    const { g } = layout('square');
    const tiles: (TileType | null)[] = g.ring.map(() => null);
    const [a, b] = g.neighbours[0];
    tiles[0] = 'bridge';
    tiles[a] = 'mill';
    tiles[b] = 'spring';
    const M = config.tiles.mill.out;
    const S = config.tiles.spring.out;
    expect(production(g, tiles, m).total).toBe(M * 2 + S);
    tiles[0] = 'beacon';
    expect(production(g, tiles, m).total).toBeCloseTo(M * 1.5 + S * 1.5);
  });
});

describe('save', () => {
  const played = () => {
    const s = initialState();
    s.ink = new Decimal('1.5e7');
    s.runInk = new Decimal('3e7');
    s.tiles[0] = 'mill';
    s.tiles[1] = 'spring';
    s.pinned = [0];
    s.chartUpg.global = 2;
    return s;
  };
  it('export -> reset -> import round-trips', () => {
    const s = played();
    const str = exportString(makeSave(s, 1000));
    const r = importSave(str);
    expect(r.ok).toBe(true);
    if (r.ok) expect(makeSave(r.state, 1000)).toEqual(makeSave(s, 1000));
    const j = importSave(toJson(makeSave(s, 1000)));
    expect(j.ok).toBe(true);
  });
  it('rejects tampered and garbage input', () => {
    const f = makeSave(played(), 1000);
    (f.state as { ink: string }).ink = '1e100';
    const r = importSave(toJson(f));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Checksum/);
    expect(importSave('not a save').ok).toBe(false);
    expect(importSave(exportString(makeSave(played(), 1)).slice(0, 40)).ok).toBe(false);
  });
});

describe('offline + prestige', () => {
  it('1h offline equals rate * 3600 * eff', () => {
    const s = initialState();
    s.tiles[0] = 'mill';
    for (const n of GRAPHS.square.neighbours[0]) s.tiles[n] = 'spring';
    const before = s.ink;
    const rate = config.tiles.mill.out * 5 + 4 * config.tiles.spring.out;
    const expected = rate * 3600 * config.offline.baseEff;
    const r = applyOffline(s, 3600);
    expect(r.ink.toNumber()).toBeCloseTo(expected, 6);
    expect(s.ink.sub(before).toNumber()).toBeCloseTo(expected, 6);
  });
  it('drift keeps pins, projection switches geometry', () => {
    const s = initialState();
    s.tiles[0] = 'mill';
    s.tiles[1] = 'spring';
    s.pinned = [0];
    s.runInk = new Decimal(config.drift.divisor * 4);
    expect(drift(s).toNumber()).toBe(2);
    expect(s.tiles.filter(Boolean)).toEqual(['mill']);
    s.cycleCharts = new Decimal(32);
    expect(project(s).toNumber()).toBe(5);
    expect(s.geometry).toBe('hyper');
    expect(s.tiles).toHaveLength(GRAPHS.hyper.ring.length);
    expect(s.tiles[0]).toBe('mill'); // first Projection keeps pins
  });
});
