import { describe, expect, it } from 'vitest';
import Decimal from 'break_eternity.js';
import { config } from '../src/core/config';
import { mobiusGraph, kleinGraph, stageGraph, torusGraph } from '../src/core/geometry/quotient';
import { GRAPHS, SURFACE_GRAPHS, initialState, type Geometry } from '../src/core/state';
import { closedLoopCount, mods, prod, production } from '../src/core/economy';
import { canFold, closedLoops, fold, foldCost, loopStatus, nextFold, project, projectionTargets } from '../src/core/prestige';
import { ACHIEVEMENTS, checkAchievements } from '../src/core/achievements';
import { fnv1a, importSave, makeSave, toJson } from '../src/core/save';
import type { TileType } from '../src/core/tiles';

const symmetric = (n: number[][]) => n.every((ns, i) => ns.every((j) => n[j].includes(i)));
const adjacent = (n: number[][], a: number, b: number) => n[a].includes(b);

/** Consecutive cells of a closed loop are neighbours and the loop returns to its start. */
function closedWalk(neighbours: number[][], loop: number[]) {
  expect(loop[0]).toBe(loop[loop.length - 1]);
  for (let i = 0; i + 1 < loop.length; i++) expect(adjacent(neighbours, loop[i], loop[i + 1])).toBe(true);
}

describe('Möbius quotient graph', () => {
  const g = mobiusGraph(24, 4);
  it('has symmetric neighbours', () => expect(symmetric(g.neighbours)).toBe(true));
  it('degree 3 on the boundary rows and 4 inside', () => {
    g.neighbours.forEach((ns, i) => {
      const y = g.xy[i][1];
      expect(ns).toHaveLength(y === 0 || y === g.height - 1 ? 3 : 4);
    });
  });
  it('the loop is a closed walk of 2*width distinct cells', () => {
    const loop = g.cycleBasis[0];
    closedWalk(g.neighbours, loop);
    expect(new Set(loop.slice(0, -1)).size).toBe(2 * g.width);
  });
  it('flipEdge is true on the seam and false elsewhere', () => {
    const seams = g.neighbours.flatMap((ns, a) => ns.filter((b) => b > a && g.seamEdge(a, b)));
    expect(seams.length).toBeGreaterThan(0);
    g.neighbours.forEach((ns, a) => ns.forEach((b) => expect(g.flipEdge(a, b)).toBe(g.seamEdge(a, b))));
    expect(g.neighbours.flatMap((ns, a) => ns.filter((b) => b > a && g.flipEdge(a, b))).length).toBe(seams.length);
  });
});

describe('closed-surface loops are closed walks', () => {
  it('torus: both loops are closed', () => {
    const g = torusGraph(16, 8);
    g.cycleBasis.forEach((loop) => closedWalk(g.neighbours, loop));
  });
  it('Klein: both loops are closed walks with distinct cells', () => {
    const g = kleinGraph(8, 8);
    expect(g.cycleBasis).toHaveLength(2);
    g.cycleBasis.forEach((loop) => {
      closedWalk(g.neighbours, loop);
      expect(new Set(loop.slice(0, -1)).size).toBe(loop.length - 1);
    });
  });
});

describe('stage graphs (Survey order)', () => {
  for (const geo of ['mobius', 'torus', 'klein'] as const) {
    it(`${geo}: ring values lie in 0..maxRing and every ring is non-empty`, () => {
      const max = config.surfaces[geo].maxRing;
      const g = GRAPHS[geo];
      const seen = new Set(g.ring);
      expect(Math.min(...g.ring)).toBe(0);
      expect(Math.max(...g.ring)).toBe(max);
      for (let r = 0; r <= max; r++) expect(seen.has(r), `ring ${r}`).toBe(true);
    });
  }
  it('stageGraph keeps the surface neighbours unchanged', () => {
    const base = mobiusGraph(12, 4);
    expect(stageGraph(base, 3).neighbours).toEqual(base.neighbours);
  });
});

describe('folds and projection targets', () => {
  const ready = () => {
    const s = initialState();
    s.projections = 1;
    s.curvature = new Decimal(1e3);
    return s;
  };
  it('no fold before the first Projection, even with Curvature', () => {
    const s = initialState();
    s.curvature = new Decimal(1e3);
    expect(canFold(s)).toBe(false);
    expect(fold(s)).toBeNull();
    expect(s.folds).toBe(0);
  });
  it('folds spend Curvature in order: Möbius, then torus, then Klein', () => {
    const s = ready();
    expect(nextFold(s)).toBe('mobius');
    expect(fold(s)).toBe('mobius');
    expect(s.folds).toBe(1);
    expect(nextFold(s)).toBe('torus');
    expect(fold(s)).toBe('torus');
    expect(fold(s)).toBe('klein');
    expect(nextFold(s)).toBeNull();
    expect(fold(s)).toBeNull();
    expect(s.folds).toBe(3);
  });
  it('canFold needs the fold cost of the next surface', () => {
    const s = ready();
    s.curvature = new Decimal(foldCost(s) - 0.5);
    expect(canFold(s)).toBe(false);
    s.curvature = new Decimal(foldCost(s));
    expect(canFold(s)).toBe(true);
  });
  it('projectionTargets is hyper plus each unlocked surface', () => {
    const s = initialState();
    expect(projectionTargets(s)).toEqual(['hyper']);
    s.folds = 2;
    expect(projectionTargets(s)).toEqual(['hyper', 'mobius', 'torus']);
  });
  it('project(target) lands on a valid target and defaults to the newest one', () => {
    const s = ready();
    s.folds = 2;
    s.cycleCharts = new Decimal(100);
    project(s, 'torus');
    expect(s.geometry).toBe('torus');
    s.cycleCharts = new Decimal(100);
    project(s, 'klein');
    expect(s.geometry).toBe('torus');
    s.cycleCharts = new Decimal(100);
    project(s);
    expect(s.geometry).toBe('torus');
    s.cycleCharts = new Decimal(100);
    project(s, 'hyper');
    expect(s.geometry).toBe('hyper');
  });
  it('project defaults to hyper before any fold', () => {
    const s = initialState();
    s.cycleCharts = new Decimal(100);
    project(s);
    expect(s.geometry).toBe('hyper');
  });
});

describe('closed loops and production', () => {
  /** A Möbius board with every cell of its loop holding a Spring, and an optional stage geometry. */
  const withTiles = (geo: Geometry, fill: (cells: number[]) => number[]) => {
    const s = initialState();
    s.folds = 3;
    s.geometry = geo;
    s.tiles = GRAPHS[geo].ring.map(() => null);
    s.ring = config.surfaces[geo as 'mobius'].maxRing;
    for (const i of fill(SURFACE_GRAPHS[geo as 'mobius'].cycleBasis[0].slice(0, -1))) s.tiles[i] = 'spring' as TileType;
    return s;
  };
  it('closedLoops and loopStatus agree on a closed Möbius loop', () => {
    const s = withTiles('mobius', (cells) => cells);
    expect(closedLoops(s)).toHaveLength(1);
    expect(loopStatus(s)).toHaveLength(1);
    expect(loopStatus(s)[0]).toMatchObject({ filled: loopStatus(s)[0].cells.length, closed: true });
  });
  it('loopStatus is empty off-surface and open when partly filled', () => {
    expect(loopStatus(initialState())).toEqual([]);
    const s = withTiles('torus', (cells) => cells.slice(1));
    const open = loopStatus(s).filter((l) => !l.closed);
    expect(open.length).toBeGreaterThan(0);
    expect(open[0].filled).toBe(open[0].cells.length - 1);
  });
  it('production multiplies by inkMult * loopMult^loops, and prod() tracks closing a loop', () => {
    const geo: Geometry = 'torus';
    const s = withTiles(geo, (cells) => cells.slice(1));
    const g = GRAPHS[geo];
    const before = prod(s).total;
    const closing = SURFACE_GRAPHS.torus.cycleBasis[0][0];
    s.tiles[closing] = 'spring';
    expect(closedLoopCount(g, s.tiles)).toBeGreaterThanOrEqual(1);
    const withLoops = prod(s).total;
    expect(withLoops).toBeCloseTo(production(g, s.tiles, mods(s)).total, 6);
    const plain = production(g, s.tiles, { ...mods(s), surface: 1, loopMult: 1 }).total;
    const loops = closedLoopCount(g, s.tiles);
    expect(withLoops / plain).toBeCloseTo(config.surfaces.torus.inkMult * config.surfaces.torus.loopMult ** loops, 6);
    expect(withLoops).toBeGreaterThan(before);
  });
  it('off-surface production has no surface multiplier', () => {
    const s = initialState();
    s.tiles[0] = 'spring';
    expect(mods(s).surface).toBe(1);
    expect(mods(s).loopMult).toBe(1);
  });
});

describe('surface achievements', () => {
  it('fold, surface and loop achievements are earned by their conditions', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    for (const id of ['fold1', 'mobius', 'torus', 'klein', 'loop1', 'torusBoth']) expect(ids).toContain(id);
    const s = initialState();
    s.folds = 1;
    s.geometry = 'mobius';
    checkAchievements(s);
    expect(s.achievements).toEqual(expect.arrayContaining(['fold1', 'mobius']));
    expect(s.achievements).not.toContain('torus');
  });
});

describe('surface saves', () => {
  for (const [i, geo] of (['mobius', 'torus', 'klein'] as const).entries()) {
    it(`round-trips a ${geo} save`, () => {
      const s = initialState();
      s.folds = i + 1;
      s.geometry = geo;
      s.tiles = GRAPHS[geo].ring.map((_, k) => (k === 0 ? 'spring' : null));
      const r = importSave(toJson(makeSave(s, 1)));
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.state.geometry).toBe(geo);
        expect(r.state.folds).toBe(i + 1);
        expect(r.state.tiles).toHaveLength(GRAPHS[geo].ring.length);
      }
    });
  }
  it('a v4 save migrates to v5 with no folds', () => {
    const state = makeSave(initialState(), 1).state;
    delete state.folds;
    const v4 = { version: 4, savedAt: 1, checksum: fnv1a(JSON.stringify(state)), state };
    const r = importSave(JSON.stringify(v4));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.folds).toBe(0);
      expect(r.state.geometry).toBe('square');
    }
  });
  it('rejects a surface geometry that is not yet unlocked', () => {
    const s = initialState();
    s.geometry = 'mobius';
    s.tiles = GRAPHS.mobius.ring.map(() => null);
    s.folds = 0;
    expect(importSave(toJson(makeSave(s, 1))).ok).toBe(false);
  });
});
