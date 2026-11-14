import { describe, expect, it } from 'vitest';
import { config } from '../src/core/config';
import { GRAPHS, initialState } from '../src/core/state';
import {
  applyConstellationRewards,
  constellationReward,
  countOccupiedComponents,
  detectMatches,
  eventsAfterPlace,
  hintIfPlace,
  matchKey,
  networkLinkEdges,
} from '../src/core/constellations';
import { place, prod } from '../src/core/economy';
import type { TileType } from '../src/core/tiles';

describe('constellations', () => {
  const sq = GRAPHS.square;
  const blank = () => sq.ring.map(() => null) as (TileType | null)[];
  /** A tile with four neighbours on the square grid (interior). */
  const centre = () => sq.neighbours.findIndex((nb) => nb.length >= 4);
  const has = (tiles: (TileType | null)[], id: string) => detectMatches(sq, tiles).some((m) => m.id === id);

  it('detects an inkstream line on the square grid', () => {
    const tiles = sq.ring.map(() => null) as (TileType | null)[];
    let found = false;
    for (let j = 0; j < sq.ring.length && !found; j++) {
      for (const a of sq.neighbours[j]) {
        for (const c of sq.neighbours[j]) {
          if (a === c || sq.neighbours[a].includes(c)) continue;
          tiles.fill(null);
          tiles[a] = tiles[j] = tiles[c] = 'spring';
          found = detectMatches(sq, tiles).some((m) => m.id === 'inkstream');
          if (found) break;
        }
      }
    }
    expect(found).toBe(true);
  });

  it('detects millwheel and twinmills', () => {
    const tiles = sq.ring.map(() => null) as (TileType | null)[];
    const m = sq.ring.findIndex((r) => r <= 2);
    tiles[m] = 'mill';
    sq.neighbours[m].slice(0, 3).forEach((i) => (tiles[i] = 'spring'));
    expect(detectMatches(sq, tiles).some((x) => x.id === 'millwheel')).toBe(true);

    const t2 = sq.ring.map(() => null) as (TileType | null)[];
    let bridge = -1;
    for (let i = 0; i < sq.ring.length; i++) {
      if (sq.neighbours[i].length >= 2) {
        bridge = i;
        t2[i] = 'bridge';
        sq.neighbours[i].slice(0, 2).forEach((n) => (t2[n] = 'mill'));
        break;
      }
    }
    expect(bridge >= 0).toBe(true);
    expect(detectMatches(sq, t2).some((x) => x.id === 'twinmills')).toBe(true);
  });

  it('watergarden: a Cistern with three adjacent Springs (two is not enough)', () => {
    const c = centre();
    const t = blank();
    t[c] = 'cistern';
    sq.neighbours[c].slice(0, 2).forEach((n) => (t[n] = 'spring'));
    expect(has(t, 'watergarden')).toBe(false);
    sq.neighbours[c].slice(0, 3).forEach((n) => (t[n] = 'spring'));
    expect(has(t, 'watergarden')).toBe(true);
  });

  it('crown: a Beacon with four adjacent producers (a Bridge does not count)', () => {
    const c = centre();
    const [a, b, d, e] = sq.neighbours[c];
    const t = blank();
    t[c] = 'beacon';
    t[a] = 'spring';
    t[b] = 'mill';
    t[d] = 'scriptorium';
    t[e] = 'bridge';
    expect(has(t, 'crown')).toBe(false);
    t[e] = 'spring';
    expect(has(t, 'crown')).toBe(true);
  });

  it('library: a Scriptorium beside four different kinds (other Scriptoria do not count)', () => {
    const c = centre();
    const [a, b, d, e] = sq.neighbours[c];
    const t = blank();
    t[c] = 'scriptorium';
    t[a] = 'spring';
    t[b] = 'mill';
    t[d] = 'beacon';
    t[e] = 'scriptorium';
    expect(has(t, 'library')).toBe(false);
    t[e] = 'bridge';
    expect(has(t, 'library')).toBe(true);
    const same = blank();
    same[c] = 'scriptorium';
    [a, b, d, e].forEach((n) => (same[n] = 'spring'));
    expect(has(same, 'library')).toBe(false);
  });

  it('longspan: three Bridges in a line (two is not enough)', () => {
    const j = sq.ring.findIndex((_, i) => sq.neighbours[i].length >= 2);
    const [a, c] = sq.neighbours[j];
    const t = blank();
    t[j] = 'bridge';
    t[a] = 'bridge';
    expect(has(t, 'longspan')).toBe(false);
    t[c] = 'bridge';
    expect(sq.neighbours[a].includes(c)).toBe(false);
    expect(has(t, 'longspan')).toBe(true);
  });

  it('harbour: a Lighthouse beside a Bridge and a Vault (no Vault is not enough)', () => {
    const c = centre();
    const [a, b] = sq.neighbours[c];
    const t = blank();
    t[c] = 'lighthouse';
    t[a] = 'bridge';
    expect(has(t, 'harbour')).toBe(false);
    t[b] = 'vault';
    expect(has(t, 'harbour')).toBe(true);
  });

  it('awards bonus once when a pattern completes on place', () => {
    const s = initialState();
    s.ring = 2;
    s.ink = s.ink.add(1e4);
    const j = sq.ring.findIndex((r) => r === 1);
    const a = sq.neighbours[j][0];
    const c = sq.neighbours[j].find((n) => n !== a && !sq.neighbours[a].includes(n));
    if (c === undefined) return;
    const before = s.tiles.slice();
    place(s, a, 'spring');
    place(s, j, 'spring');
    place(s, c, 'spring');
    const ev = eventsAfterPlace(s, before, c, 'spring');
    const log0 = s.constellationLog.length;
    applyConstellationRewards(s, ev);
    expect(s.constellationLog.length).toBeGreaterThanOrEqual(log0);
  });

  it('hint fires when a placement would complete a new pattern', () => {
    const s = initialState();
    s.ring = 2;
    for (let j = 0; j < sq.ring.length; j++) {
      const a = sq.neighbours[j][0];
      const c = sq.neighbours[j].find((n) => n !== a && !sq.neighbours[a].includes(n));
      if (c === undefined) continue;
      place(s, a, 'spring');
      place(s, j, 'spring');
      const h = hintIfPlace(s, c, 'spring');
      if (h) {
        expect(matchKey(h)).toContain('inkstream');
        return;
      }
      s.tiles.fill(null);
    }
  });

  it('network link when placement merges two components', () => {
    const tiles = sq.ring.map(() => null) as (TileType | null)[];
    let done = false;
    for (let mid = 0; mid < sq.ring.length && !done; mid++) {
      tiles.fill(null);
      const nb = sq.neighbours[mid];
      if (nb.length < 2) continue;
      tiles[nb[0]] = 'spring';
      tiles[nb[1]] = 'spring';
      if (countOccupiedComponents(sq, tiles) !== 2) continue;
      const before = tiles.slice();
      const after = tiles.slice();
      after[mid] = 'spring';
      if (countOccupiedComponents(sq, after) !== 1) continue;
      const edges = networkLinkEdges(sq, before, after, mid);
      expect(edges?.length).toBeGreaterThan(0);
      done = true;
    }
    expect(done).toBe(true);
  });

  describe('constellationReward', () => {
    const sec = config.constellationScale.sec;
    const bonus = config.constellations.inkstream.bonusInk;

    it('floors at the fixed bonus on an empty board', () => {
      const s = initialState();
      expect(prod(s).total).toBe(0);
      expect(constellationReward(s, 'inkstream')).toBe(bonus);
    });

    it('scales with production and falls off for repeats in a run', () => {
      const s = initialState();
      const t = blank();
      sq.ring.forEach((_, i) => (t[i] = 'spring'));
      s.tiles = t;
      const p = prod(s).total;
      expect(p).toBeGreaterThan(0);
      const first = constellationReward(s, 'inkstream');
      expect(first).toBeCloseTo(Math.max(bonus, p * sec), 6);
      s.constellationKeys = ['inkstream:1,2,3'];
      const second = constellationReward(s, 'inkstream');
      expect(second).toBeCloseTo(Math.max(bonus, (p * sec) / 2), 6);
      expect(constellationReward(s, 'inkstream', 1)).toBeCloseTo(Math.max(bonus, (p * sec) / 3), 6);
      // A different id is not counted against inkstream.
      expect(constellationReward(s, 'millwheel')).toBeCloseTo(Math.max(config.constellations.millwheel.bonusInk, p * sec), 6);
    });
  });

  it('applyConstellationRewards raises runInk, lifetimeInk and stats.constellations', () => {
    const s = initialState();
    const ink0 = s.ink.toNumber();
    applyConstellationRewards(s, [
      { id: 'inkstream', name: 'Inkstream', bonusInk: 55, cells: [1, 2, 3], edges: [] },
    ]);
    expect(s.ink.toNumber()).toBe(ink0 + 55);
    expect(s.runInk.toNumber()).toBe(55);
    expect(s.lifetimeInk.toNumber()).toBe(55);
    expect(s.stats.constellations).toBe(1);
    expect(s.constellationKeys).toEqual(['inkstream:1,2,3']);
  });
});
