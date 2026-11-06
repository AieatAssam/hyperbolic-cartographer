// Pure graph-anchored FX model: per-tile embedding frames, production routes, edge legs and seam stubs,
// and survey reveal waves. No DOM and no Three imports, so it runs under Vitest in Node.
//
// Positions are table world units (the same space as Board.tops). Normals and tangents are unit length.
// Route and wave functions only see a TileGraph (ring[], neighbours[][]), never the geometry.

import type { TileGraph } from '../core/geometry/graph';
import type { TileType } from '../core/tiles';

export type Tuple3 = [number, number, number];

/** Floats per tile in Embedding.data: [x, y, z, s, nx, ny, nz, tx]. */
export const EMBED_STRIDE = 8;
/**
 * Former distance cutoff (in pitches). Not read by isSeam any more: length is not topology, and the length rule
 * flagged all 546 edges of the live hyper board. Kept exported so existing imports still compile.
 */
export const SEAM_K = 2.5;
/**
 * Visual timing and shape of routed FX. Lives here, not in config.ts (these are not balance), and moves
 * to the FX tokens in palette.ts when the GPU renderer is wired in B2.
 */
export const ROUTE_TIMING = { legLife: 0.38, lift: 0.25, stub: 0.5, trail: 0.12 } as const;
/** Seconds per ring for the survey wave. Moves to FX.waveStep in B2. */
export const SURVEY_WAVE_STEP = 0.07;

/** Per-tile frame that FX reads. Rewritten by the board on rebuild; `rev` bumps once per rebuild. */
export interface Embedding {
  count: number;
  /** count * EMBED_STRIDE floats: [x, y, z, s, nx, ny, nz, tx]. s = local scale in 0..1 (0 = hidden). tx is reserved, 0. */
  data: Float32Array;
  rev: number;
  /** World length of one neighbour chord at s = 1 (1 on the square board). The shader multiplies it by s, so it scales every anchored radius, lift and stub. */
  pitch: number;
  /**
   * Cut-edge metadata: return true only for an edge that is cut in the drawn layout. Without it no edge is a seam.
   * A fundamental-polygon provider (a quotient view with glued sides) must set this. Closed immersed surfaces, like
   * the hyperbolic disk, draw continuous world edges and leave it unset.
   */
  seam?: (a: number, b: number) => boolean;
}

export interface Frame {
  p: Tuple3;
  s: number;
  n: Tuple3;
}

const UP: Tuple3 = [0, 1, 0];
const isFinite3 = (v: Tuple3) => Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);
const len = (v: Tuple3) => Math.hypot(v[0], v[1], v[2]);
const unit = (v: Tuple3): Tuple3 => {
  const L = len(v);
  return L > 1e-9 && Number.isFinite(L) ? [v[0] / L, v[1] / L, v[2] / L] : [0, 1, 0];
};
const cross = (a: Tuple3, b: Tuple3): Tuple3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const clamp01 = (t: number) => (t > 0 ? (t < 1 ? t : 1) : 0);
const posTime = (x: number) => (Number.isFinite(x) && x > 0 ? x : 0);

export function createEmbedding(count: number): Embedding {
  if (!Number.isInteger(count) || count < 0) throw new Error('Embedding count must be a non-negative integer');
  const data = new Float32Array(count * EMBED_STRIDE);
  for (let i = 0; i < count; i++) data[i * EMBED_STRIDE + 5] = 1; // normal +Y; scale 0 keeps it hidden until written
  return { count, data, rev: 0, pitch: 1 };
}

/**
 * Writes tile i's frame. Repairs instead of trusting input: non-finite positions hide the tile at the origin,
 * a bad scale hides it, scale above 1 is clamped, and a zero or non-finite normal falls back to +Y.
 * Returns false when anything was repaired or the index is out of range (nothing is written then).
 */
export function writeFrame(e: Embedding, i: number, f: Frame): boolean {
  if (!validIndex(e, i)) return false;
  let ok = true;
  let p = f.p;
  let s = f.s;
  if (!isFinite3(p)) (p = [0, 0, 0]), (s = 0), (ok = false);
  if (!Number.isFinite(s)) (s = 0), (ok = false);
  else if (s <= 0) s = 0; // hidden on purpose, not a repair
  else if (s > 1) (s = 1), (ok = false);
  let n = f.n;
  const L = len(n);
  if (!isFinite3(n) || !(L > 1e-6)) (n = UP), (ok = false);
  else if (Math.abs(L - 1) > 1e-6) (n = unit(n)), (ok = false);
  const o = i * EMBED_STRIDE, d = e.data;
  d[o] = p[0]; d[o + 1] = p[1]; d[o + 2] = p[2]; d[o + 3] = s;
  d[o + 4] = n[0]; d[o + 5] = n[1]; d[o + 6] = n[2]; d[o + 7] = 0;
  return ok;
}

/** Reads back tile i's frame (copies out of the buffer). */
export function frameAt(e: Embedding, i: number): Frame {
  const o = i * EMBED_STRIDE, d = e.data;
  return { p: [d[o], d[o + 1], d[o + 2]], s: d[o + 3], n: [d[o + 4], d[o + 5], d[o + 6]] };
}

/** Marks a full rebuild. Call once per rebuild, not per tile. */
export function bumpRev(e: Embedding): number {
  return ++e.rev;
}

const validIndex = (e: Embedding, i: number) => Number.isInteger(i) && i >= 0 && i < e.count;
const scaleOf = (e: Embedding, i: number) => e.data[i * EMBED_STRIDE + 3];
const posOf = (e: Embedding, i: number): Tuple3 => {
  const o = i * EMBED_STRIDE;
  return [e.data[o], e.data[o + 1], e.data[o + 2]];
};
const normalOf = (e: Embedding, i: number): Tuple3 => {
  const o = i * EMBED_STRIDE;
  return unit([e.data[o + 4], e.data[o + 5], e.data[o + 6]]);
};

/**
 * Median length of the undirected edges of g, given per-node planar positions. Without `scale` this is the raw median
 * chord. With `scale` (per-node local scale s) each chord is first divided by its endpoints' mean s, so the result is
 * the chord at s = 1. That is the unit Embedding.pitch expects, because the shader multiplies pitch by s again.
 * Edges whose mean scale is zero are skipped. Planar positions only: never pass extruded heights.
 */
export function medianEdgePitch(g: TileGraph, xy: readonly (readonly [number, number])[], scale?: readonly number[]): number {
  const lens: number[] = [];
  g.neighbours.forEach((ns, i) => {
    for (const j of ns) {
      if (j <= i) continue;
      let d = Math.hypot(xy[i][0] - xy[j][0], xy[i][1] - xy[j][1]);
      if (scale) d /= (scale[i] + scale[j]) / 2;
      if (Number.isFinite(d) && d > 0) lens.push(d);
    }
  });
  if (!lens.length) return 1;
  lens.sort((a, b) => a - b);
  return lens[lens.length >> 1];
}

/**
 * True only when the embedding's explicit cut-edge test returns true for a–b. With no metadata every edge is
 * continuous. Positions and lengths say nothing about topology: on the disk, rim neighbours are short in world
 * units and still connected.
 */
export function isSeam(e: Embedding, a: number, b: number): boolean {
  if (a === b || !validIndex(e, a) || !validIndex(e, b)) return false;
  return e.seam?.(a, b) === true;
}

/** Orthonormal tangent basis of unit normal n. The GLSL mirror must use the same reference axis. */
export function tangentBasis(n: Tuple3): [Tuple3, Tuple3] {
  const ref: Tuple3 = Math.abs(n[1]) < 0.9 ? UP : [1, 0, 0];
  const t = unit(cross(ref, n));
  return [t, cross(n, t)];
}

/**
 * Lift direction for the edge a–b: the normalised sum of the two normals. When the normals (nearly) cancel,
 * use the tangent of the lower-index tile's normal. Both directions of an edge then give the same answer.
 */
export function legNormal(e: Embedding, a: number, b: number): Tuple3 {
  const na = normalOf(e, a), nb = normalOf(e, b);
  const sum: Tuple3 = [na[0] + nb[0], na[1] + nb[1], na[2] + nb[2]];
  if (len(sum) >= 1e-3) return unit(sum);
  return tangentBasis(normalOf(e, Math.min(a, b)))[0];
}

/** CPU mirror of the GPU Leg path: mix(pA, pB, u) + lift·pitch·s̄·sin(πu)·n̄. u is clamped to 0..1. */
export function legPoint(e: Embedding, a: number, b: number, u: number, lift: number = ROUTE_TIMING.lift): Tuple3 {
  const k = clamp01(u), pa = posOf(e, a), pb = posOf(e, b), n = legNormal(e, a, b);
  const sBar = (scaleOf(e, a) + scaleOf(e, b)) / 2;
  const bump = lift * e.pitch * sBar * Math.sin(Math.PI * k);
  return [0, 1, 2].map((c) => pa[c] + (pb[c] - pa[c]) * k + n[c] * bump) as Tuple3;
}

/**
 * Half-leg stub for a seam edge: a tangential run of length stub·s·pitch from `anchor` toward `toward`, in
 * anchor's tangent plane. u runs 0..1. Falls back to the anchor's tangent when the direction is degenerate.
 * A non-finite result collapses to the anchor.
 */
export function stubPoint(e: Embedding, anchor: number, toward: number, u: number): Tuple3 {
  const n = normalOf(e, anchor), pa = posOf(e, anchor), pt = posOf(e, toward);
  const d: Tuple3 = [pt[0] - pa[0], pt[1] - pa[1], pt[2] - pa[2]];
  const dot = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
  let dir = unit([d[0] - dot * n[0], d[1] - dot * n[1], d[2] - dot * n[2]]);
  if (len(d) < 1e-9) dir = tangentBasis(n)[0];
  const r = ROUTE_TIMING.stub * scaleOf(e, anchor) * e.pitch * clamp01(u);
  const out: Tuple3 = [pa[0] + dir[0] * r, pa[1] + dir[1] * r, pa[2] + dir[2] * r];
  return isFinite3(out) ? out : pa;
}

/** One step of an edge's FX: a full leg, or a half-leg stub on a seam. Times are absolute seconds. */
export type EdgePart =
  | { kind: 'leg'; from: number; to: number; delay: number; life: number }
  | { kind: 'stub'; anchor: number; toward: number; phase: 'leave' | 'arrive'; delay: number; life: number };

/**
 * Plans the FX of edge a→b starting at `delay` for `life` seconds. A normal edge is one leg. A seam edge is two
 * stubs in sequence: anchor a fades out leaving toward the seam, then b fades in arriving at b. Returns [] for
 * invalid indices, a == b, or two hidden endpoints.
 */
export function planEdge(e: Embedding, a: number, b: number, delay: number, life: number): EdgePart[] {
  if (!validIndex(e, a) || !validIndex(e, b) || a === b) return [];
  if (!(scaleOf(e, a) > 0 || scaleOf(e, b) > 0)) return [];
  const d0 = posTime(delay), L = posTime(life);
  if (!isSeam(e, a, b)) return [{ kind: 'leg', from: a, to: b, delay: d0, life: L }];
  return [
    { kind: 'stub', anchor: a, toward: b, phase: 'leave', delay: d0, life: L },
    { kind: 'stub', anchor: b, toward: a, phase: 'arrive', delay: d0 + L, life: L },
  ];
}

// ---- Production routes -------------------------------------------------------------------------------

export type RouteKind = 'feed' | 'boost';
/** A node path that carries production: nodes[0] is the source, the last node is the target. */
export type Route = { nodes: number[]; source: TileType; kind: RouteKind };

const clampReach = (r: number) => (Number.isFinite(r) ? Math.max(0, Math.floor(r)) : 0);

/**
 * Shortest bridge-only paths from `a` to every node it reaches within `reach` interior bridges, as in
 * economy.adjacency. Only `a` and bridges relay, so every interior node is a bridge. Breadth-first, so the
 * paths are shortest and the search terminates on loops.
 */
function bridgeTree(g: TileGraph, tiles: (TileType | null)[], a: number, reach: number): Map<number, number[]> {
  const found = new Map<number, number[]>();
  const seen = new Set<number>([a]);
  const maxEdges = reach + 1; // d edges give d - 1 interior nodes
  let layer: number[][] = [[a]];
  for (let d = 1; d <= maxEdges && layer.length; d++) {
    const next: number[][] = [];
    for (const path of layer) {
      const u = path[path.length - 1];
      if (u !== a && tiles[u] !== 'bridge') continue;
      for (const v of g.neighbours[u]) {
        if (seen.has(v)) continue;
        seen.add(v);
        const p = [...path, v];
        found.set(v, p);
        next.push(p);
      }
    }
    layer = next;
  }
  return found;
}

/** Shortest path a→b whose interior nodes are all bridges, with at most `reach` of them. Null if none. */
export function bridgePath(g: TileGraph, tiles: (TileType | null)[], a: number, b: number, reach: number): number[] | null {
  if (a === b || !(a >= 0 && a < g.ring.length) || !(b >= 0 && b < g.ring.length)) return null;
  const p = bridgeTree(g, tiles, a, clampReach(reach)).get(b);
  return p ? p.slice() : null;
}

const routeCache = new WeakMap<TileGraph, { key: string; routes: Route[] }>();

/**
 * Production routes that match economy production pair for pair. A feed route runs Spring → Mill. A boost route
 * runs Beacon → Spring or Mill. Each path follows real graph edges through bridges only.
 * Memoised per graph on the tiles and reach. Callers must not mutate the result.
 */
export function productionRoutes(g: TileGraph, tiles: (TileType | null)[], reach: number): Route[] {
  const r = clampReach(reach);
  const key = `${r}|${tiles.join(',')}`;
  const hit = routeCache.get(g);
  if (hit?.key === key) return hit.routes;
  const routes: Route[] = [];
  for (let a = 0; a < g.ring.length; a++) {
    const ta = tiles[a];
    if (ta !== 'spring' && ta !== 'beacon') continue;
    const tree = bridgeTree(g, tiles, a, r);
    for (const b of [...tree.keys()].sort((x, y) => x - y)) {
      const tb = tiles[b];
      const kind: RouteKind | null = ta === 'spring' && tb === 'mill' ? 'feed' : ta === 'beacon' && (tb === 'mill' || tb === 'spring') ? 'boost' : null;
      if (kind) routes.push({ nodes: tree.get(b)!, source: ta, kind });
    }
  }
  routeCache.set(g, { key, routes });
  return routes;
}

export interface RouteLeg { from: number; to: number; delay: number }
export interface RelayGlint { node: number; at: number }

/**
 * Schedules a route's edges as sequential legs. Leg k starts at t0 + k·legLife. Each interior bridge flashes a relay
 * glint when the leg arrives there (at t0 + k·legLife, k = its position along the path).
 */
export function routeSchedule(route: Route, legLife: number = ROUTE_TIMING.legLife, t0 = 0): { legs: RouteLeg[]; relays: RelayGlint[] } {
  const L = posTime(legLife), start = posTime(t0), n = route.nodes;
  const legs: RouteLeg[] = [];
  for (let k = 0; k + 1 < n.length; k++) legs.push({ from: n[k], to: n[k + 1], delay: start + k * L });
  const relays: RelayGlint[] = [];
  for (let k = 1; k + 1 < n.length; k++) relays.push({ node: n[k], at: start + k * L });
  return { legs, relays };
}

/** Keeps the longest prefix of routes that fits in maxLegs edges. Bounds the pool a route burst can take. */
export function capRoutes(routes: readonly Route[], maxLegs: number): Route[] {
  const cap = Number.isFinite(maxLegs) ? Math.max(0, Math.floor(maxLegs)) : 0;
  const out: Route[] = [];
  let used = 0;
  for (const r of routes) {
    const edges = r.nodes.length - 1;
    if (used + edges > cap) break;
    used += edges;
    out.push(r);
  }
  return out;
}

// ---- Survey waves -----------------------------------------------------------------------------------

export interface WaveCell { i: number; delay: number; strong: boolean }

/** Evenly spaced picks of up to `take` items, always including the first. Deterministic, no randomness. */
function spaced(list: number[], take: number): number[] {
  if (take >= list.length) return list.slice();
  const out: number[] = [];
  for (let j = 0; j < take; j++) out.push(list[Math.floor((j * list.length) / take)]);
  return out;
}

/**
 * Cells to animate for a survey from prevRing to newRing, at most `budget` in total. Every newly active cell is
 * included while the budget allows. Above it, the cells are sampled evenly. The rest of the budget goes to
 * faint glints on already-active cells. A cell's delay is its ring · step, so the wave runs outward from the centre.
 * `strong` marks the new ring, which gets the full pop.
 */
export function surveyWave(g: TileGraph, prevRing: number, newRing: number, budget: number, step = SURVEY_WAVE_STEP): WaveCell[] {
  const cap = Number.isFinite(budget) ? Math.max(0, Math.floor(budget)) : 0;
  if (!Number.isFinite(prevRing) || !Number.isFinite(newRing) || newRing <= prevRing || cap === 0) return [];
  const fresh: number[] = [], old: number[] = [];
  g.ring.forEach((r, i) => {
    if (r <= prevRing) old.push(i);
    else if (r <= newRing) fresh.push(i);
  });
  const freshPick = spaced(fresh, cap);
  const glints = spaced(old, cap - freshPick.length);
  const cell = (i: number, strong: boolean): WaveCell => ({ i, delay: g.ring[i] * step, strong });
  const out = [...freshPick.map((i) => cell(i, g.ring[i] === newRing)), ...glints.map((i) => cell(i, false))];
  return out.sort((x, y) => x.delay - y.delay || x.i - y.i);
}

/**
 * Board reveal spans for a survey: every cell whose ring is newly active or in the next ring (prevRing, newRing + 1].
 * Unlike surveyWave this is not sampled, so the board rise covers every cell. Delay = ring · step.
 */
export function revealSpans(g: TileGraph, prevRing: number, newRing: number, step = SURVEY_WAVE_STEP): { i: number; delay: number }[] {
  if (!Number.isFinite(prevRing) || !Number.isFinite(newRing) || newRing <= prevRing) return [];
  const out: { i: number; delay: number }[] = [];
  g.ring.forEach((r, i) => {
    if (r > prevRing && r <= newRing + 1) out.push({ i, delay: r * step });
  });
  return out;
}
