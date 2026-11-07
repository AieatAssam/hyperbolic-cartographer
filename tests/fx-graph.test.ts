import { describe, expect, it } from 'vitest';
import { adjacency } from '../src/core/economy';
import { apply, boost, hyperGraph, identity, mul, orthonormalize, toDisk, type HyperBoard, type Mat3 } from '../src/core/geometry/hyperbolic';
import type { TileGraph } from '../src/core/geometry/graph';
import { ringCounts } from '../src/core/geometry/graph';
import { squareGraph } from '../src/core/geometry/square';
import { GRAPHS as LIVE } from '../src/core/state';
import type { TileType } from '../src/core/tiles';
import { readFileSync } from 'node:fs';
import { mulberry32 } from '../src/render/fx-model';
import { FX } from '../src/art/palette';
import {
  EMBED_STRIDE,
  ROUTE_TIMING,
  SEAM_K,
  SURVEY_WAVE_STEP,
  bridgePath,
  bumpRev,
  capRoutes,
  createEmbedding,
  frameAt,
  isSeam,
  legNormal,
  legPoint,
  medianEdgePitch,
  planEdge,
  productionRoutes,
  revealSpans,
  routeSchedule,
  stubPoint,
  surveyWave,
  tangentBasis,
  writeFrame,
  type Embedding,
  type Route,
  type Tuple3,
} from '../src/render/fx-graph';

// Same radii as state.ts GRAPHS: square maxRing 5, hyper maxRing + 1.
const GRAPHS: Record<'square' | 'hyper', TileGraph> = {
  square: squareGraph(5),
  hyper: hyperGraph(4),
};

const TYPE_WEIGHTS: [TileType | null, number][] = [
  [null, 0.15],
  ['spring', 0.2],
  ['mill', 0.2],
  ['beacon', 0.1],
  ['bridge', 0.3],
  ['vault', 0.05],
];

function randomTiles(n: number, rand: () => number): (TileType | null)[] {
  const total = TYPE_WEIGHTS.reduce((s, [, w]) => s + w, 0);
  return Array.from({ length: n }, () => {
    let x = rand() * total;
    for (const [t, w] of TYPE_WEIGHTS) {
      x -= w;
      if (x < 0) return t;
    }
    return null;
  });
}

/** Economy production pairs as route-shaped keys: feed Spring→Mill and boost Beacon→Spring/Mill. */
function economyPairs(g: TileGraph, tiles: (TileType | null)[], reach: number): string[] {
  const out = new Set<string>();
  tiles.forEach((t, i) => {
    if (t !== 'mill' && t !== 'spring') return;
    for (const n of adjacency(g, tiles, i, reach)) {
      if (t === 'mill' && tiles[n] === 'spring') out.add(`feed ${n}>${i}`);
      if (tiles[n] === 'beacon') out.add(`boost ${n}>${i}`);
    }
  });
  return [...out].sort();
}

const routePairs = (routes: Route[]) =>
  routes.map((r) => `${r.kind} ${r.nodes[0]}>${r.nodes[r.nodes.length - 1]}`).sort();

/** Independent reference: BFS over bridge-only interiors, returns the edge count of the shortest path or null. */
function refDistance(g: TileGraph, tiles: (TileType | null)[], a: number, b: number, reach: number): number | null {
  const dist = new Map<number, number>([[a, 0]]);
  let frontier = [a];
  while (frontier.length) {
    const next: number[] = [];
    for (const u of frontier) {
      const d = dist.get(u)!;
      if (d >= reach + 1) continue;
      if (u !== a && tiles[u] !== 'bridge') continue;
      for (const v of g.neighbours[u]) {
        if (dist.has(v)) continue;
        dist.set(v, d + 1);
        next.push(v);
      }
    }
    frontier = next;
  }
  return dist.get(b) ?? null;
}

const finite = (v: Tuple3) => v.every(Number.isFinite);
const norm = (v: Tuple3) => Math.hypot(v[0], v[1], v[2]);
const dot = (a: Tuple3, b: Tuple3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const dist3 = (a: Tuple3, b: Tuple3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Embedding with every tile written from the given frames (index = tile). */
function embedOf(frames: { p: Tuple3; s: number; n: Tuple3 }[]): Embedding {
  const e = createEmbedding(frames.length);
  frames.forEach((f, i) => writeFrame(e, i, f));
  return e;
}

describe('productionRoutes matches economy adjacency pair for pair', () => {
  for (const name of ['square', 'hyper'] as const) {
    for (const reach of [1, 2]) {
      it(`${name}, reach ${reach}: 200 seeded random boards`, () => {
        const g = GRAPHS[name];
        for (let seed = 1; seed <= 200; seed++) {
          const tiles = randomTiles(g.ring.length, mulberry32(seed * 7919 + reach));
          const routes = productionRoutes(g, tiles, reach);
          expect(routePairs(routes), `${name} reach ${reach} seed ${seed}`).toEqual(economyPairs(g, tiles, reach));
        }
      });
    }
  }

  it('feed routes start at a Spring and end at a Mill; boost routes start at a Beacon', () => {
    const g = GRAPHS.hyper;
    const tiles = randomTiles(g.ring.length, mulberry32(42));
    const routes = productionRoutes(g, tiles, 2);
    expect(routes.length).toBeGreaterThan(0);
    for (const r of routes) {
      const end = tiles[r.nodes[r.nodes.length - 1]];
      if (r.kind === 'feed') {
        expect(r.source).toBe('spring');
        expect(tiles[r.nodes[0]]).toBe('spring');
        expect(end).toBe('mill');
      } else {
        expect(r.source).toBe('beacon');
        expect(tiles[r.nodes[0]]).toBe('beacon');
        expect(end === 'mill' || end === 'spring').toBe(true);
      }
    }
  });

  it('a hand-built path: a bridge-only chain of 2 bridges links Spring to Mill at reach 2, not reach 1', () => {
    // 0 spring — 1 bridge — 2 bridge — 3 mill — 4 beacon
    const g: TileGraph = { ring: [0, 1, 2, 3, 4], neighbours: [[1], [0, 2], [1, 3], [2, 4], [3]] };
    const tiles: (TileType | null)[] = ['spring', 'bridge', 'bridge', 'mill', 'beacon'];
    expect(routePairs(productionRoutes(g, tiles, 1))).toEqual(['boost 4>3']);
    expect(routePairs(productionRoutes(g, tiles, 2))).toEqual(['boost 4>3', 'feed 0>3']);
    expect(routePairs(productionRoutes(g, tiles, 2))).toEqual(economyPairs(g, tiles, 2).sort());
    const feed = productionRoutes(g, tiles, 2).find((r) => r.kind === 'feed')!;
    expect(feed.nodes).toEqual([0, 1, 2, 3]);
  });

  it('empty interior tiles break a route, so no chord crosses an empty cell', () => {
    const g: TileGraph = { ring: [0, 1, 2, 3], neighbours: [[1], [0, 2], [1, 3], [2]] };
    const tiles: (TileType | null)[] = ['spring', null, 'bridge', 'mill'];
    expect(productionRoutes(g, tiles, 2)).toEqual([]);
    expect(economyPairs(g, tiles, 2)).toEqual([]);
  });

  it('memoises per graph, tiles and reach, and recomputes when the board changes', () => {
    const g = GRAPHS.square;
    const tiles = randomTiles(g.ring.length, mulberry32(9));
    const a = productionRoutes(g, tiles, 1);
    expect(productionRoutes(g, tiles.slice(), 1)).toBe(a);
    const changed = tiles.slice();
    changed[0] = changed[0] === 'spring' ? 'mill' : 'spring';
    expect(productionRoutes(g, changed, 1)).not.toBe(a);
  });
});

describe('bridge paths and route edges', () => {
  it('every route is a simple path of real graph edges with bridge-only interiors within reach', () => {
    for (const name of ['square', 'hyper'] as const) {
      const g = GRAPHS[name];
      for (const reach of [1, 2]) {
        for (let seed = 1; seed <= 60; seed++) {
          const tiles = randomTiles(g.ring.length, mulberry32(seed * 131 + reach));
          for (const r of productionRoutes(g, tiles, reach)) {
            const { nodes } = r;
            expect(new Set(nodes).size, `${name} simple`).toBe(nodes.length);
            expect(nodes.length - 2, `${name} reach`).toBeLessThanOrEqual(reach);
            for (let k = 0; k + 1 < nodes.length; k++) {
              expect(g.neighbours[nodes[k]], `${name} edge`).toContain(nodes[k + 1]);
            }
            for (const interior of nodes.slice(1, -1)) expect(tiles[interior], `${name} interior`).toBe('bridge');
          }
        }
      }
    }
  });

  it('bridgePath is the shortest bridge-only path, matching an independent BFS on random pairs', () => {
    for (const name of ['square', 'hyper'] as const) {
      const g = GRAPHS[name];
      const n = g.ring.length;
      for (let seed = 1; seed <= 50; seed++) {
        const rand = mulberry32(seed * 977);
        const tiles = randomTiles(n, rand);
        for (let k = 0; k < 20; k++) {
          const a = Math.floor(rand() * n), b = Math.floor(rand() * n);
          const reach = 1 + Math.floor(rand() * 2);
          const want = a === b ? null : refDistance(g, tiles, a, b, reach); // a path needs two distinct ends
          const got = bridgePath(g, tiles, a, b, reach);
          if (want === null) {
            expect(got, `${name} ${a}->${b}`).toBeNull();
          } else {
            expect(got, `${name} ${a}->${b}`).not.toBeNull();
            expect(got!.length - 1, `${name} ${a}->${b} shortest`).toBe(want);
            expect(got![0]).toBe(a);
            expect(got![got!.length - 1]).toBe(b);
          }
        }
      }
    }
  });

  it('bridgePath is deterministic and picks the first shortest path in neighbour order on a loop', () => {
    // 4-cycle 0-1-2-3-0: 0 spring, 2 mill, 1 and 3 bridges. Two equal paths; neighbour order decides.
    const g: TileGraph = { ring: [0, 0, 0, 0], neighbours: [[1, 3], [0, 2], [1, 3], [2, 0]] };
    const tiles: (TileType | null)[] = ['spring', 'bridge', 'mill', 'bridge'];
    const first = bridgePath(g, tiles, 0, 2, 1);
    expect(first).toEqual([0, 1, 2]);
    expect(bridgePath(g, tiles, 0, 2, 1)).toEqual(first);
    expect(bridgePath(g, tiles, 0, 0, 1)).toBeNull();
    expect(bridgePath(g, tiles, -1, 2, 1)).toBeNull();
    expect(bridgePath(g, tiles, 0, 9, 1)).toBeNull();
  });

  it('bridgePath returns a copy, so callers cannot corrupt the cache', () => {
    const g: TileGraph = { ring: [0, 0, 0], neighbours: [[1], [0, 2], [1]] };
    const tiles: (TileType | null)[] = ['spring', 'bridge', 'mill'];
    const p = bridgePath(g, tiles, 0, 2, 1)!;
    p.push(99);
    expect(bridgePath(g, tiles, 0, 2, 1)).toEqual([0, 1, 2]);
  });

  it('non-integer or negative reach is treated as a whole number, never negative', () => {
    const g: TileGraph = { ring: [0, 0, 0], neighbours: [[1], [0, 2], [1]] };
    const tiles: (TileType | null)[] = ['spring', 'bridge', 'mill'];
    expect(bridgePath(g, tiles, 0, 2, -3)).toBeNull();
    expect(bridgePath(g, tiles, 0, 2, 1.9)).toEqual([0, 1, 2]);
    expect(bridgePath(g, tiles, 0, 2, NaN)).toBeNull();
  });
});

describe('route schedule', () => {
  it('legs chain end to start along the path, one legLife apart, with no gaps or jumps', () => {
    const g = GRAPHS.hyper;
    for (let seed = 1; seed <= 40; seed++) {
      const tiles = randomTiles(g.ring.length, mulberry32(seed * 31));
      for (const r of productionRoutes(g, tiles, 2)) {
        const { legs, relays } = routeSchedule(r, ROUTE_TIMING.legLife, 2);
        expect(legs.length).toBe(r.nodes.length - 1);
        legs.forEach((leg, k) => {
          expect(leg.from).toBe(r.nodes[k]);
          expect(leg.to).toBe(r.nodes[k + 1]);
          expect(leg.delay).toBeCloseTo(2 + k * ROUTE_TIMING.legLife, 12);
          if (k > 0) expect(leg.from).toBe(legs[k - 1].to);
        });
        expect(relays.length).toBe(Math.max(0, r.nodes.length - 2));
        relays.forEach((rl, k) => {
          expect(rl.node).toBe(r.nodes[k + 1]);
          expect(rl.at).toBeCloseTo(legs[k].delay + ROUTE_TIMING.legLife, 12);
        });
      }
    }
  });

  it('clamps non-finite or negative leg life and start time to zero', () => {
    const r: Route = { nodes: [0, 1, 2], source: 'spring', kind: 'feed' };
    const { legs } = routeSchedule(r, NaN, -5);
    expect(legs.map((l) => l.delay)).toEqual([0, 0]);
  });
});

describe('capRoutes', () => {
  const g = GRAPHS.hyper;
  const tiles = randomTiles(g.ring.length, mulberry32(77));
  const routes = productionRoutes(g, tiles, 2);
  const edges = (rs: Route[]) => rs.reduce((s, r) => s + r.nodes.length - 1, 0);

  it('never exceeds the leg cap and keeps a prefix of the routes', () => {
    for (const cap of [0, 1, 3, 12, 48, 1000]) {
      const out = capRoutes(routes, cap);
      expect(edges(out), `cap ${cap}`).toBeLessThanOrEqual(cap);
      expect(out).toEqual(routes.slice(0, out.length));
    }
  });

  it('is maximal: the first dropped route would not fit in the remaining budget', () => {
    for (const cap of [1, 5, 20, 60]) {
      const out = capRoutes(routes, cap);
      if (out.length < routes.length) {
        const next = routes[out.length];
        expect(edges(out) + (next.nodes.length - 1), `cap ${cap}`).toBeGreaterThan(cap);
      }
    }
  });

  it('a large cap keeps everything, and zero, NaN or negative caps keep nothing', () => {
    expect(capRoutes(routes, 1e6)).toEqual(routes);
    expect(capRoutes(routes, 0)).toEqual([]);
    expect(capRoutes(routes, NaN)).toEqual([]);
    expect(capRoutes(routes, -4)).toEqual([]);
  });
});

describe('embedding frames', () => {
  it('starts every tile hidden (s = 0) with a +Y normal, and rev 0', () => {
    const e = createEmbedding(5);
    expect(e.count).toBe(5);
    expect(e.data.length).toBe(5 * EMBED_STRIDE);
    expect(e.rev).toBe(0);
    expect(frameAt(e, 4)).toMatchObject({ p: [0, 0, 0], s: 0, n: [0, 1, 0], chi: 1 });
  });

  it('rejects invalid counts', () => {
    expect(() => createEmbedding(-1)).toThrow();
    expect(() => createEmbedding(1.5)).toThrow();
  });

  it('round-trips a valid frame and writes nothing else', () => {
    const e = createEmbedding(3);
    expect(writeFrame(e, 1, { p: [1, 2, 3], s: 0.5, n: [0, 0, 1] })).toBe(true);
    const f = frameAt(e, 1);
    expect(f.p[0]).toBeCloseTo(1, 6);
    expect(f.p[1]).toBeCloseTo(2, 6);
    expect(f.p[2]).toBeCloseTo(3, 6);
    expect(f.s).toBeCloseTo(0.5, 6);
    expect(f.n[2]).toBeCloseTo(1, 6);
    expect(frameAt(e, 0)).toMatchObject({ p: [0, 0, 0], s: 0, n: [0, 1, 0] });
  });

  it('replaces a non-finite position with the origin, hides the tile, and reports the repair', () => {
    const e = createEmbedding(1);
    expect(writeFrame(e, 0, { p: [NaN, 0, 0], s: 1, n: [0, 1, 0] })).toBe(false);
    expect(frameAt(e, 0)).toMatchObject({ p: [0, 0, 0], s: 0, n: [0, 1, 0] });
    expect(writeFrame(e, 0, { p: [0, Infinity, 0], s: 1, n: [0, 1, 0] })).toBe(false);
    expect(frameAt(e, 0).s).toBe(0);
  });

  it('hides a tile with a non-finite scale, and clamps a scale above 1 to 1', () => {
    const e = createEmbedding(3);
    expect(writeFrame(e, 0, { p: [1, 0, 0], s: NaN, n: [0, 1, 0] })).toBe(false);
    expect(frameAt(e, 0).s).toBe(0);
    expect(writeFrame(e, 1, { p: [1, 0, 0], s: Infinity, n: [0, 1, 0] })).toBe(false);
    expect(frameAt(e, 1).s).toBe(0);
    expect(writeFrame(e, 2, { p: [1, 0, 0], s: 2, n: [0, 1, 0] })).toBe(false);
    expect(frameAt(e, 2).s).toBe(1);
  });

  it('treats a non-positive scale as deliberately hidden, not as a repair', () => {
    const e = createEmbedding(1);
    expect(writeFrame(e, 0, { p: [1, 2, 3], s: -1, n: [0, 1, 0] })).toBe(true);
    expect(frameAt(e, 0).s).toBe(0);
    expect(writeFrame(e, 0, { p: [1, 2, 3], s: 0, n: [0, 1, 0] })).toBe(true);
    expect(frameAt(e, 0).s).toBe(0);
  });

  it('falls back to +Y for a zero or non-finite normal, and normalises a non-unit normal', () => {
    const e = createEmbedding(4);
    expect(writeFrame(e, 0, { p: [0, 0, 0], s: 1, n: [0, 0, 0] })).toBe(false);
    expect(frameAt(e, 0).n).toEqual([0, 1, 0]);
    expect(writeFrame(e, 1, { p: [0, 0, 0], s: 1, n: [NaN, 0, 0] })).toBe(false);
    expect(frameAt(e, 1).n).toEqual([0, 1, 0]);
    expect(writeFrame(e, 2, { p: [0, 0, 0], s: 1, n: [2, 0, 0] })).toBe(false);
    expect(frameAt(e, 2).n[0]).toBeCloseTo(1, 6);
    expect(writeFrame(e, 3, { p: [0, 0, 0], s: 1, n: [1, 1, 0] })).toBe(false);
    const n3 = frameAt(e, 3).n;
    expect(norm(n3)).toBeCloseTo(1, 6);
    expect(n3[0]).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it('rejects out-of-range and non-integer indices without writing', () => {
    const e = createEmbedding(2);
    writeFrame(e, 0, { p: [1, 1, 1], s: 1, n: [0, 0, 1] });
    const before = e.data.slice();
    for (const i of [-1, 2, 1.5, NaN]) {
      expect(writeFrame(e, i, { p: [9, 9, 9], s: 1, n: [0, 1, 0] }), `index ${i}`).toBe(false);
    }
    expect(e.data).toEqual(before);
  });

  it('bumps rev exactly once per call to bumpRev, and writes never bump it', () => {
    const e = createEmbedding(2);
    writeFrame(e, 0, { p: [0, 0, 0], s: 1, n: [0, 1, 0] });
    writeFrame(e, 1, { p: [1, 0, 0], s: 1, n: [0, 1, 0] });
    expect(e.rev).toBe(0);
    expect(bumpRev(e)).toBe(1);
    expect(bumpRev(e)).toBe(2);
    expect(e.rev).toBe(2);
  });

  it('medianEdgePitch is the median undirected edge length, and 1 when there are no edges', () => {
    const g: TileGraph = { ring: [0, 0, 0], neighbours: [[1], [0, 2], [1]] };
    expect(medianEdgePitch(g, [[0, 0], [2, 0], [4, 0]])).toBe(2);
    expect(medianEdgePitch({ ring: [0], neighbours: [[]] }, [[0, 0]])).toBe(1);
    const sq = squareGraph(2);
    expect(medianEdgePitch(sq, sq.xy)).toBe(1);
  });

  it('with per-node scales, each chord is divided by its endpoints mean scale before the median', () => {
    const g: TileGraph = { ring: [0, 0, 0], neighbours: [[1], [0, 2], [1]] };
    // chord 2 over mean scale 0.75 → 8/3; chord 4 over mean scale 0.375 → 32/3. Median of two is the upper, 32/3.
    expect(medianEdgePitch(g, [[0, 0], [2, 0], [6, 0]], [1, 0.5, 0.25])).toBeCloseTo(32 / 3, 12);
    // a hidden endpoint (scale 0) on edge 0–1 gives a non-finite ratio, so only edge 1–2 counts: 4 / 0.5 = 8
    expect(medianEdgePitch(g, [[0, 0], [2, 0], [6, 0]], [0, 0, 1])).toBe(8);
  });
});

describe('nonplanar frames, opposite normals and the local-normal lift', () => {
  it('nonplanar random frames give finite, unit leg normals and finite leg points for every u', () => {
    const rand = mulberry32(2026);
    const unitRand = (): Tuple3 => {
      const v: Tuple3 = [rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1];
      return norm(v) < 1e-3 ? [0, 0, 1] : [v[0] / norm(v), v[1] / norm(v), v[2] / norm(v)];
    };
    const frames = Array.from({ length: 30 }, () => ({
      p: [rand() * 6 - 3, rand() * 6 - 3, rand() * 6 - 3] as Tuple3,
      s: 0.2 + rand() * 0.8,
      n: unitRand(),
    }));
    const e = embedOf(frames);
    for (let a = 0; a < frames.length; a++) {
      for (let b = 0; b < frames.length; b++) {
        if (a === b) continue;
        const n = legNormal(e, a, b);
        expect(finite(n)).toBe(true);
        expect(norm(n)).toBeCloseTo(1, 6);
        for (let k = 0; k <= 8; k++) expect(finite(legPoint(e, a, b, k / 8))).toBe(true);
      }
    }
  });

  it('opposite normals give a finite unit lift that is the tangent of the lower-index normal, and is symmetric', () => {
    const e = embedOf([
      { p: [0, 0, 0], s: 1, n: [0, 1, 0] },
      { p: [1, 0, 0], s: 1, n: [0, -1, 0] },
      { p: [0, 0, 1], s: 1, n: [0, 1, 0] },
    ]);
    const n01 = legNormal(e, 0, 1);
    expect(finite(n01)).toBe(true);
    expect(norm(n01)).toBeCloseTo(1, 6);
    expect(n01).toEqual(legNormal(e, 1, 0));
    expect(n01).toEqual(tangentBasis([0, 1, 0])[0]);
    expect(Math.abs(dot(n01, [0, 1, 0]))).toBeLessThan(1e-9);
    // Each point along the leg stays finite with a tangent lift.
    for (let k = 0; k <= 10; k++) expect(finite(legPoint(e, 0, 1, k / 10))).toBe(true);
  });

  it('lifts along the local normal, not world Y: a wall tile at x = 0 bulges along its own normal', () => {
    // Chord from (0,0,0) to (0,2,0) lies along Y; both normals point along +X.
    const e = embedOf([
      { p: [0, 0, 0], s: 1, n: [1, 0, 0] },
      { p: [0, 2, 0], s: 1, n: [1, 0, 0] },
    ]);
    const mid = legPoint(e, 0, 1, 0.5);
    expect(mid[0]).toBeCloseTo(ROUTE_TIMING.lift, 9);
    expect(mid[1]).toBeCloseTo(1, 9);
    expect(mid[2]).toBeCloseTo(0, 9);
    expect(legPoint(e, 0, 1, 0)).toEqual([0, 0, 0]);
    expect(legPoint(e, 0, 1, 1)[1]).toBeCloseTo(2, 9);
  });

  it('scales the lift by the mean local scale, so a hidden endpoint halves it', () => {
    const e = embedOf([
      { p: [0, 0, 0], s: 1, n: [1, 0, 0] },
      { p: [0, 2, 0], s: 0.5, n: [1, 0, 0] },
    ]);
    const mid = legPoint(e, 0, 1, 0.5);
    expect(mid[0]).toBeCloseTo(ROUTE_TIMING.lift * 0.75, 9);
  });

  it('multiplies the lift by pitch, as the GPU does: lift·pitch·s̄·sin(πu), at pitch 3.7 too', () => {
    const e = embedOf([
      { p: [0, 0, 0], s: 1, n: [1, 0, 0] },
      { p: [0, 2, 0], s: 0.5, n: [1, 0, 0] },
    ]);
    e.pitch = 3.7;
    const mid = legPoint(e, 0, 1, 0.5);
    expect(mid[0]).toBeCloseTo(ROUTE_TIMING.lift * 3.7 * 0.75, 9);
    expect(mid[1]).toBeCloseTo(1, 9); // the chord itself is not scaled by pitch
    for (let k = 0; k <= 10; k++) {
      const u = k / 10;
      const want = ROUTE_TIMING.lift * 3.7 * 0.75 * Math.sin(Math.PI * u);
      expect(legPoint(e, 0, 1, u)[0], `u ${u}`).toBeCloseTo(want, 9);
    }
  });

  it('keeps the FX tokens equal to the fx-graph timing constants that the model uses', () => {
    expect(FX.legLife).toBe(ROUTE_TIMING.legLife);
    expect(FX.legLift).toBe(ROUTE_TIMING.lift);
    expect(FX.stub).toBe(ROUTE_TIMING.stub);
    expect(FX.trail).toBe(ROUTE_TIMING.trail);
    expect(FX.waveStep).toBe(SURVEY_WAVE_STEP);
  });

  it('parallel normals give that normal exactly, so the lift is not skewed by the chord direction', () => {
    const e = embedOf([
      { p: [0, 0, 0], s: 1, n: [0, 0, 1] },
      { p: [1, 0, 0], s: 1, n: [0, 0, 1] },
    ]);
    expect(legNormal(e, 0, 1)).toEqual([0, 0, 1]);
  });
});

describe('seam edges: two half-leg stubs, no teleport or chord', () => {
  // Flat table, pitch 1. Tile 0 and 1 are neighbours; tile 2 is across an explicit cut from tile 0.
  const flat = (x: number) => ({ p: [x, 0, 0] as Tuple3, s: 1, n: [0, 1, 0] as Tuple3 });
  const cut = (a: number, b: number) => (a === 0 && b === 2) || (a === 2 && b === 0);
  const e = (() => {
    const emb = embedOf([flat(0), flat(1), flat(5)]);
    emb.pitch = 1;
    emb.seam = cut;
    return emb;
  })();

  it('an explicit cut is a seam, and every other edge is not', () => {
    expect(isSeam(e, 0, 2)).toBe(true);
    expect(isSeam(e, 0, 1)).toBe(false);
  });

  it('distance alone never makes a seam: a far edge with no cut metadata is continuous', () => {
    const far = embedOf([flat(0), flat(5)]);
    far.pitch = 1;
    expect(isSeam(far, 0, 1)).toBe(false);
    expect(planEdge(far, 0, 1, 0, 0.38)).toEqual([{ kind: 'leg', from: 0, to: 1, delay: 0, life: 0.38 }]);
  });

  it('the explicit cut test decides in both directions, whatever the distance', () => {
    const custom = embedOf([flat(0), flat(5)]);
    custom.seam = () => false;
    expect(isSeam(custom, 0, 1)).toBe(false);
    custom.seam = () => true;
    expect(isSeam(custom, 0, 1)).toBe(true);
    const near = embedOf([flat(0), flat(1)]);
    near.seam = () => true;
    expect(isSeam(near, 0, 1)).toBe(true);
  });

  it('only a strict true from the cut test counts as a seam', () => {
    const truthy = embedOf([flat(0), flat(1)]);
    truthy.seam = () => 1 as unknown as boolean;
    expect(isSeam(truthy, 0, 1)).toBe(false);
  });

  it('a seam edge is two stubs in sequence: leave a, then arrive at b, with no overlap', () => {
    const parts = planEdge(e, 0, 2, 0.2, 0.4);
    expect(parts.length).toBe(2);
    const [leave, arrive] = parts;
    expect(leave).toMatchObject({ kind: 'stub', anchor: 0, toward: 2, phase: 'leave', life: 0.4 });
    expect(arrive).toMatchObject({ kind: 'stub', anchor: 2, toward: 0, phase: 'arrive', life: 0.4 });
    expect(leave.delay).toBeCloseTo(0.2, 12);
    expect(arrive.delay).toBeCloseTo(leave.delay + leave.life, 12); // starts exactly when the first half ends
    expect(parts.some((p) => p.kind === 'leg')).toBe(false);
  });

  it('a normal edge is exactly one leg', () => {
    expect(planEdge(e, 0, 1, 0.1, 0.38)).toEqual([{ kind: 'leg', from: 0, to: 1, delay: 0.1, life: 0.38 }]);
  });

  it('invalid, self, and doubly-hidden edges plan nothing; negative or NaN times clamp to 0', () => {
    expect(planEdge(e, 0, 0, 0, 1)).toEqual([]);
    expect(planEdge(e, -1, 1, 0, 1)).toEqual([]);
    expect(planEdge(e, 0, 9, 0, 1)).toEqual([]);
    const hidden = embedOf([{ p: [0, 0, 0], s: 0, n: [0, 1, 0] }, { p: [9, 0, 0], s: 0, n: [0, 1, 0] }]);
    expect(planEdge(hidden, 0, 1, 0, 1)).toEqual([]);
    expect(isSeam(hidden, 0, 1)).toBe(false);
    expect(planEdge(e, 0, 1, NaN, -2)).toEqual([{ kind: 'leg', from: 0, to: 1, delay: 0, life: 0 }]);
  });

  it('stub points start at the anchor, run tangentially for at most stub·s·pitch, and never reach the far end', () => {
    const maxLen = ROUTE_TIMING.stub * 1 * 1;
    expect(stubPoint(e, 0, 2, 0)).toEqual([0, 0, 0]);
    for (let k = 0; k <= 10; k++) {
      const p = stubPoint(e, 0, 2, k / 10);
      expect(finite(p)).toBe(true);
      expect(p[1]).toBeCloseTo(0, 12); // stays in the tangent plane of a flat table
      expect(dist3(p, [0, 0, 0])).toBeLessThanOrEqual(maxLen + 1e-9);
      expect(dist3(p, [5, 0, 0])).toBeGreaterThan(4);
    }
    expect(stubPoint(e, 0, 2, 1)[0]).toBeCloseTo(maxLen, 9);
  });

  it('a degenerate stub (toward at the anchor position) still gives a finite tangent run', () => {
    const same = embedOf([flat(3), flat(3)]);
    const p = stubPoint(same, 0, 1, 1);
    expect(finite(p)).toBe(true);
    expect(dist3(p, [3, 0, 0])).toBeCloseTo(ROUTE_TIMING.stub, 9);
  });
});

// Regression: the distance rule cut all 546 edges of the live hyper board. Frames below follow board.ts (outline and
// update) and its pan(), so these are the frames the player actually sees, not a synthetic layout.
describe('live hyper board: no quotient seams without cut metadata', () => {
  const hb = LIVE.hyper as HyperBoard;
  const DISK_R = 9; // board.ts DISK_R
  const xy: [number, number][] = hb.centers.map((c) => {
    const [u, w] = toDisk(c);
    return [u * DISK_R, w * DISK_R];
  });
  const pitch = medianEdgePitch(hb, xy);
  const edges: [number, number][] = [];
  hb.neighbours.forEach((ns, i) => ns.forEach((j) => { if (j > i) edges.push([i, j]); }));

  // board.ts pan(): boost by the drag in disk units, then re-orthonormalise the view.
  const panned = (view: Mat3, dx: number, dz: number): Mat3 => {
    const du = dx / DISK_R, dw = dz / DISK_R, m = Math.hypot(du, dw);
    return orthonormalize(mul(boost(2 * Math.atanh(Math.min(0.9, m)), Math.atan2(dw, du)), view));
  };
  // board.ts outline(): centre of the viewed tile on the disk · DISK_R, local scale 1 - r².
  const boardFrames = (view: Mat3) => hb.centers.map((c) => {
    const [cu, cw] = toDisk(apply(view, c));
    return { p: [cu * DISK_R, 0, cw * DISK_R] as Tuple3, s: Math.max(0, 1 - cu * cu - cw * cw), n: [0, 1, 0] as Tuple3 };
  });

  const views: [string, Mat3][] = [
    ['identity view', identity()],
    ['pan 4 units', panned(identity(), 4, 0)],
    ['pan -5, 3 units', panned(identity(), -5, 3)],
    ['pan 0, 7 units, then 6, -2', panned(panned(identity(), 0, 7), 6, -2)],
  ];

  it('the live hyper graph has edges to check', () => {
    expect(edges.length).toBeGreaterThan(0);
  });

  it('the fixture is not vacuous: the old length rule would have cut every edge on the identity view', () => {
    const e = embedOf(boardFrames(identity()));
    e.pitch = pitch;
    const ratios = edges.map(([a, b]) => {
      const fa = frameAt(e, a), fb = frameAt(e, b);
      return dist3(fa.p, fb.p) / (SEAM_K * Math.max(fa.s, fb.s) * pitch);
    });
    expect(Math.min(...ratios)).toBeGreaterThan(1);
  });

  for (const [label, view] of views) {
    it(`${label}: no edge is a seam, and every edge draws as one continuous leg`, () => {
      const e = embedOf(boardFrames(view));
      e.pitch = pitch;
      expect(e.seam).toBeUndefined();
      for (const [a, b] of edges) {
        expect(isSeam(e, a, b), `${label} edge ${a}-${b}`).toBe(false);
        expect(planEdge(e, a, b, 0, ROUTE_TIMING.legLife).map((p) => p.kind), `${label} edge ${a}-${b}`).toEqual(['leg']);
      }
    });
  }

  // Pitch units (B1): board.ts stores the identity-view chord per unit scale. The shader multiplies pitch by s again,
  // so each edge's planar chord over its mean s should sit near one pitch at every view. s is conformal, so that
  // holds after a boost-pan without recomputing the stored value.
  const scale = xy.map(([x, z]) => Math.max(0, 1 - (x * x + z * z) / (DISK_R * DISK_R)));
  const chordPitch = medianEdgePitch(hb, xy, scale);
  const planar = (a: Tuple3, b: Tuple3) => Math.hypot(a[0] - b[0], a[2] - b[2]); // x and z only, never extruded height

  it('the chord-per-scale pitch is far above the raw rim median it replaces, so the old value was too small', () => {
    expect(Number.isFinite(chordPitch) && chordPitch > 0).toBe(true);
    expect(chordPitch).toBeGreaterThan(2.5 * pitch);
  });

  for (const [label, view] of views) {
    it(`${label}: at least 90% of edges have a normalised chord ratio in [0.6, 1.6]`, () => {
      const f = boardFrames(view);
      const ratios = edges.map(([a, b]) => planar(f[a].p, f[b].p) / (((f[a].s + f[b].s) / 2) * chordPitch));
      const inBand = ratios.filter((r) => r >= 0.6 && r <= 1.6).length;
      expect(inBand / ratios.length).toBeGreaterThanOrEqual(0.9);
    });
  }

  it('square pitch is exactly 1 with unit scales, and every edge ratio is exactly 1', () => {
    const sq = squareGraph(5);
    const ones = sq.ring.map(() => 1);
    expect(medianEdgePitch(sq, sq.xy, ones)).toBe(1);
    sq.neighbours.forEach((ns, i) => ns.forEach((j) => {
      expect(Math.hypot(sq.xy[i][0] - sq.xy[j][0], sq.xy[i][1] - sq.xy[j][1]) / 1).toBe(1);
    }));
  });
});

describe('survey waves and board reveal coverage', () => {
  const step = SURVEY_WAVE_STEP;

  for (const name of ['square', 'hyper'] as const) {
    it(`${name}: every fresh cell is animated while the budget allows, with budget-bounded output`, () => {
      const g = GRAPHS[name];
      const counts = ringCounts(g);
      const maxRing = counts.length - 1;
      for (let newRing = 1; newRing <= maxRing; newRing++) {
        for (let prevRing = 0; prevRing < newRing; prevRing++) {
          const fresh = g.ring.flatMap((r, i) => (r > prevRing && r <= newRing ? [i] : []));
          const old = g.ring.flatMap((r, i) => (r <= prevRing ? [i] : []));
          for (const budget of [64, 128, 256]) {
            const wave = surveyWave(g, prevRing, newRing, budget);
            const label = `${name} ${prevRing}->${newRing} budget ${budget}`;
            expect(wave.length, label).toBe(Math.min(budget, fresh.length + old.length));
            expect(new Set(wave.map((c) => c.i)).size, `${label} unique`).toBe(wave.length);
            if (fresh.length <= budget) {
              const picked = new Set(wave.map((c) => c.i));
              for (const i of fresh) expect(picked.has(i), `${label} fresh ${i}`).toBe(true);
            } else {
              expect(wave.every((c) => g.ring[c.i] > prevRing), `${label} fresh-only`).toBe(true);
            }
            for (const c of wave) {
              expect(c.delay, label).toBeCloseTo(g.ring[c.i] * step, 12);
              if (c.strong) expect(g.ring[c.i], label).toBe(newRing);
              if (g.ring[c.i] <= prevRing) expect(c.strong, label).toBe(false);
            }
            for (let k = 1; k < wave.length; k++) expect(wave[k].delay >= wave[k - 1].delay, label).toBe(true);
          }
        }
      }
    });
  }

  it('is deterministic, and empty for a zero budget, a non-growing ring, or non-finite input', () => {
    const g = GRAPHS.hyper;
    expect(surveyWave(g, 2, 3, 64)).toEqual(surveyWave(g, 2, 3, 64));
    expect(surveyWave(g, 2, 3, 0)).toEqual([]);
    expect(surveyWave(g, 3, 3, 64)).toEqual([]);
    expect(surveyWave(g, 3, 2, 64)).toEqual([]);
    expect(surveyWave(g, NaN, 3, 64)).toEqual([]);
    expect(surveyWave(g, 2, 3, NaN)).toEqual([]);
  });

  it('marks the new ring strong and every cell of the new ring is animated when it fits', () => {
    const g = GRAPHS.square;
    const wave = surveyWave(g, 1, 2, 256);
    const newRingCells = g.ring.flatMap((r, i) => (r === 2 ? [i] : []));
    const strongs = new Set(wave.filter((c) => c.strong).map((c) => c.i));
    expect(strongs.size).toBe(newRingCells.length);
    for (const i of newRingCells) expect(strongs.has(i)).toBe(true);
  });

  it('reveal spans cover exactly the newly active and next-ring cells, once each, with delay = ring · step', () => {
    for (const name of ['square', 'hyper'] as const) {
      const g = GRAPHS[name];
      const counts = ringCounts(g);
      for (let newRing = 1; newRing < counts.length - 1; newRing++) {
        const prevRing = newRing - 1;
        const spans = revealSpans(g, prevRing, newRing);
        const want = g.ring.flatMap((r, i) => (r > prevRing && r <= newRing + 1 ? [i] : []));
        expect(spans.map((s) => s.i).sort((a, b) => a - b)).toEqual(want);
        expect(spans.length).toBe(want.length);
        let expected = 0;
        for (let r = prevRing + 1; r <= newRing + 1; r++) expected += counts[r] ?? 0;
        expect(spans.length).toBe(expected);
        for (const s of spans) expect(s.delay).toBeCloseTo(g.ring[s.i] * step, 12);
      }
    }
  });

  it('reveal spans are empty when the ring does not grow', () => {
    expect(revealSpans(GRAPHS.hyper, 2, 2)).toEqual([]);
    expect(revealSpans(GRAPHS.hyper, 3, 2)).toEqual([]);
    expect(revealSpans(GRAPHS.hyper, NaN, 3)).toEqual([]);
  });
});

describe('module purity', () => {
  it('imports neither Three nor the DOM', () => {
    const src = readFileSync(new URL('../src/render/fx-graph.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/from ['"]three['"]/);
    expect(src).not.toMatch(/\bdocument\./);
    expect(src).not.toMatch(/\bwindow\./);
  });
});
