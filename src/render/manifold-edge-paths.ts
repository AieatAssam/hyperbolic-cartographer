/**
 * Graph-edge FX paths that follow the parametric skin. Each edge is walked in lifted grid coordinates
 * (b is placed in a's chart, so the segment never wraps through parameter space). The Klein glide
 * seam is crossed via the glide (Y → h − Y), which is what the surface actually does.
 */
import type { SurfaceGraph } from '../core/geometry/quotient';
import type { Embedding } from './fx-graph';
import { ROUTE_TIMING } from './fx-graph';
import { config } from '../core/config';
import { NO_FLOW, surfaceFrame, type Flow, type Surface3d } from './surface-params';

const EDGE_PATH_K = 12;

const undirectedEdges = (g: SurfaceGraph): [number, number][] => {
  const out: [number, number][] = [];
  g.neighbours.forEach((ns, i) => ns.forEach((j) => { if (j > i) out.push([i, j]); }));
  return out;
};

/** Lifted step (dx, dy) in cells from a's centre to b's centre in a's chart. */
function liftedStep(g: SurfaceGraph, a: number, b: number, flip: boolean): [number, number] {
  const [xa, ya] = g.xy[a], [xb, yb] = g.xy[b];
  let dx = xb - xa;
  if (dx > 1) dx -= g.width;
  else if (dx < -1) dx += g.width;
  let dy: number;
  if (flip) {
    // Glide: crossing the seam maps row Y to h − Y, so b's lifted row sits on a's row.
    dy = g.height - yb - 1 - ya;
  } else {
    dy = yb - ya;
    if (dy > 1) dy -= g.height;
    else if (dy < -1) dy += g.height;
  }
  return [dx, dy];
}

function buildSurfaceEdgePaths(g: SurfaceGraph, e: Embedding, surface: Surface3d, flow: Flow) {
  const edges = undirectedEdges(g);
  const K = EDGE_PATH_K;
  const path = new Float32Array(edges.length * K * 3);
  const liftK = config.manifold.manifoldLegLift / ROUTE_TIMING.lift;
  edges.forEach(([a, b], row) => {
    const flip = surface === 'klein' && g.flipEdge(a, b);
    const [dx, dy] = liftedStep(g, a, b, flip);
    const [xa, ya] = g.xy[a];
    for (let k = 0; k < K; k++) {
      const t = (k + 0.5) / K;
      const f = surfaceFrame(surface, xa + 0.5 + dx * t, ya + 0.5 + dy * t, g.width, g.height, flow, 0);
      const lift = ROUTE_TIMING.lift * e.pitch * liftK * Math.sin(Math.PI * t);
      const o = (row * K + k) * 3;
      path[o] = f.p[0] + f.n[0] * lift;
      path[o + 1] = f.p[1] + f.n[1] * lift;
      path[o + 2] = f.p[2] + f.n[2] * lift;
    }
  });
  e.edgePath = path;
  e.edgePathRows = edges.length;
}

export function buildTorusSurfaceEdgePaths(g: SurfaceGraph, e: Embedding, flow: Flow = NO_FLOW): void {
  buildSurfaceEdgePaths(g, e, 'torus', flow);
}

export function buildKleinSurfaceEdgePaths(g: SurfaceGraph, e: Embedding, flow: Flow = NO_FLOW): void {
  buildSurfaceEdgePaths(g, e, 'klein', flow);
}
