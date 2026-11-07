/** Graph-edge FX paths that follow the parametric skin (not 3D chords through the hole). */
import type { SurfaceGraph } from '../core/geometry/quotient';
import type { Embedding } from './fx-graph';
import { ROUTE_TIMING } from './fx-graph';
import { config } from '../core/config';
import { kleinGridToUv, kleinImmersionFrame, kleinImmersionPos, gridToUv, torusNormalFromUv, torusPosFromUv } from './surface-params';

const EDGE_PATH_K = 12;

const undirectedEdges = (g: SurfaceGraph): [number, number][] => {
  const out: [number, number][] = [];
  g.neighbours.forEach((ns, i) => ns.forEach((j) => { if (j > i) out.push([i, j]); }));
  return out;
};

const wrapDelta = (d: number) => {
  const p = Math.PI * 2;
  let x = d;
  while (x > p / 2) x -= p;
  while (x < -p / 2) x += p;
  return x;
};

function torusUvOf(g: SurfaceGraph, i: number): [number, number] {
  const [x, y] = g.xy[i];
  return gridToUv(x + 0.5, y + 0.5, g.width, g.height);
}

function kleinUvOf(g: SurfaceGraph, i: number): [number, number] {
  const [x, y] = g.xy[i];
  return kleinGridToUv(x + 0.5, y + 0.5, g.width, g.height);
}

export function buildTorusSurfaceEdgePaths(g: SurfaceGraph, e: Embedding): void {
  const edges = undirectedEdges(g);
  const K = EDGE_PATH_K;
  const path = new Float32Array(edges.length * K * 3);
  const liftK = config.manifold.manifoldLegLift / ROUTE_TIMING.lift;
  edges.forEach(([a, b], row) => {
    const [ua, va] = torusUvOf(g, a);
    const [ub, vb] = torusUvOf(g, b);
    const du = wrapDelta(ub - ua), dv = wrapDelta(vb - va);
    for (let k = 0; k < K; k++) {
      const t = (k + 0.5) / K;
      const u = ua + du * t, v = va + dv * t;
      const p = torusPosFromUv(u, v);
      const n = torusNormalFromUv(u, v);
      const lift = ROUTE_TIMING.lift * e.pitch * liftK * Math.sin(Math.PI * t);
      const o = (row * K + k) * 3;
      path[o] = p[0] + n[0] * lift;
      path[o + 1] = p[1] + n[1] * lift;
      path[o + 2] = p[2] + n[2] * lift;
    }
  });
  e.edgePath = path;
  e.edgePathRows = edges.length;
}

export function buildKleinSurfaceEdgePaths(g: SurfaceGraph, e: Embedding): void {
  const edges = undirectedEdges(g);
  const K = EDGE_PATH_K;
  const path = new Float32Array(edges.length * K * 3);
  const liftK = config.manifold.manifoldLegLift / ROUTE_TIMING.lift;
  edges.forEach(([a, b], row) => {
    const [ua, va] = kleinUvOf(g, a);
    const [ub, vb] = kleinUvOf(g, b);
    const du = ub - ua;
    const dv = wrapDelta(vb - va);
    for (let k = 0; k < K; k++) {
      const t = (k + 0.5) / K;
      const u = ua + du * t, v = va + dv * t;
      const p = kleinImmersionPos(u, v);
      const n = kleinImmersionFrame(u, v).n;
      const lift = ROUTE_TIMING.lift * e.pitch * liftK * Math.sin(Math.PI * t);
      const o = (row * K + k) * 3;
      path[o] = p[0] + n[0] * lift;
      path[o + 1] = p[1] + n[1] * lift;
      path[o + 2] = p[2] + n[2] * lift;
    }
  });
  e.edgePath = path;
  e.edgePathRows = edges.length;
}
