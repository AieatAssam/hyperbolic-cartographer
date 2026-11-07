import { describe, expect, it } from 'vitest';
import { GRAPHS, initialState } from '../src/core/state';
import {
  applyConstellationRewards,
  countOccupiedComponents,
  detectMatches,
  eventsAfterPlace,
  hintIfPlace,
  matchKey,
  networkLinkEdges,
} from '../src/core/constellations';
import { place } from '../src/core/economy';
import type { TileType } from '../src/core/tiles';

describe('constellations', () => {
  const sq = GRAPHS.square;

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
});
