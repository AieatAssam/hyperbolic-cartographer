/**
 * C0–C4 embedding providers: pure functions that write frames (and optional edge paths)
 * into an Embedding from a TileGraph. No DOM, no Three.
 */
import type { SquareBoard } from '../core/geometry/square';
import type { SurfaceGraph } from '../core/geometry/quotient';
import type { HyperBoard, Mat3 } from '../core/geometry/hyperbolic';
import { apply, toDisk } from '../core/geometry/hyperbolic';
import {
  bumpRev,
  createEmbedding,
  medianEdgePitch,
  writeFrameExt,
  buildEdgePaths,
  transportChirality,
  type Embedding,
  type Tuple3,
} from './fx-graph';
import {
  chartCell, chartCellCenter, NO_FLOW, surfaceFrame, type Flow,
} from './surface-params';
import { buildKleinSurfaceEdgePaths, buildTorusSurfaceEdgePaths } from './manifold-edge-paths';

export const DISK_R = 9;

function fillPortals(g: SurfaceGraph, out: Embedding, at: (i: number) => Tuple3) {
  out.seam = (a, b) => g.seamEdge(a, b);
  if (!out.portals) out.portals = [];
  else out.portals.length = 0;
  g.neighbours.forEach((ns, a) => {
    for (const b of ns) {
      if (b <= a || !g.seamEdge(a, b)) continue;
      out.portals!.push({ a, b, portA: at(a), portB: at(b), flip: g.flipEdge(a, b) });
    }
  });
}

export interface PlaneEmbedParams {
  gap?: number;
}

export interface DiskEmbedParams {
  view: Mat3;
  diskR?: number;
  gap?: number;
}

export interface TorusEmbedParams {
  majorR?: number;
  minorR?: number;
  chart?: boolean;
  /** 3D only: shifts the tiling over the torus (see surface-params Flow). */
  flow?: Flow;
}

export interface KleinEmbedParams {
  chart?: boolean;
  cell?: number;
  /** immersion only: glide of the tiling along the tube */
  flow?: Flow;
}

/** C0: square tabletop frames (matches board.ts outline at identity view). */
export function embedPlane(g: SquareBoard, out: Embedding, _params: PlaneEmbedParams = {}): Embedding {
  const scale = g.ring.map(() => 1);
  out.pitch = medianEdgePitch(g, g.xy, scale);
  for (let i = 0; i < g.ring.length; i++) {
    const [x, y] = g.xy[i];
    writeFrameExt(out, i, { p: [x, 0, y], s: 1, n: [0, 1, 0], t: [1, 0, 0], chi: 1 });
  }
  delete out.seam;
  buildEdgePaths(g, out, (a, b) => {
    const pa = [g.xy[a][0], 0, g.xy[a][1]] as Tuple3;
    const pb = [g.xy[b][0], 0, g.xy[b][1]] as Tuple3;
    return { pa, pb, na: [0, 1, 0] as Tuple3, nb: [0, 1, 0] as Tuple3 };
  });
  bumpRev(out);
  return out;
}

/** C0: Poincaré disk frames (matches board.ts with a Lorentz view). */
export function embedDisk(g: HyperBoard, out: Embedding, params: DiskEmbedParams): Embedding {
  const diskR = params.diskR ?? DISK_R;
  const view = params.view;
  const xy: [number, number][] = g.centers.map((c) => {
    const [u, w] = toDisk(apply(view, c));
    return [u * diskR, w * diskR];
  });
  const scale = xy.map(([x, z]) => Math.max(0, 1 - (x * x + z * z) / (diskR * diskR)));
  out.pitch = medianEdgePitch(g, xy, scale);
  for (let i = 0; i < g.ring.length; i++) {
    const cv = apply(view, g.centers[i]);
    const [cu, cw] = toDisk(cv);
    const s = Math.max(0, 1 - cu * cu - cw * cw);
    writeFrameExt(out, i, { p: [cu * diskR, 0, cw * diskR], s, n: [0, 1, 0], t: [1, 0, 0], chi: 1 });
  }
  delete out.seam;
  buildEdgePaths(g, out, (a, b) => {
    const pa: Tuple3 = [xy[a][0], 0, xy[a][1]];
    const pb: Tuple3 = [xy[b][0], 0, xy[b][1]];
    return { pa, pb, na: [0, 1, 0], nb: [0, 1, 0] };
  });
  bumpRev(out);
  return out;
}

/** C3: 3D torus or fundamental-square chart. */
export function embedTorus(g: SurfaceGraph, out: Embedding, params: TorusEmbedParams = {}): Embedding {
  const chart = params.chart ?? false;
  const flow = params.flow ?? NO_FLOW;
  const cell = chartCell(g.width, g.height);
  const at = (i: number): Tuple3 => {
    const [x, y] = g.xy[i];
    if (chart) return chartCellCenter(x, y, g.width, g.height, cell);
    return surfaceFrame('torus', x + 0.5, y + 0.5, g.width, g.height, flow).p;
  };
  if (chart) {
    const xy = g.xy.map(([x, y]) => {
      const c = chartCellCenter(x, y, g.width, g.height, cell);
      return [c[0], c[2]] as [number, number];
    });
    out.pitch = medianEdgePitch(g, xy);
    out.chart2d = new Float32Array(g.ring.length * 2);
    for (let i = 0; i < g.ring.length; i++) {
      const f = at(i);
      out.chart2d[i * 2] = f[0];
      out.chart2d[i * 2 + 1] = f[2];
      writeFrameExt(out, i, { p: f, s: 1, n: [0, 1, 0], t: [1, 0, 0], chi: 1 });
    }
    fillPortals(g, out, at);
  } else {
    const flat: [number, number][] = g.xy.map(([x, y]) => {
      const { p } = surfaceFrame('torus', x + 0.5, y + 0.5, g.width, g.height, flow);
      return [p[0], p[2]];
    });
    out.pitch = medianEdgePitch(g, flat, g.ring.map(() => 1));
    out.chart2d = new Float32Array(g.ring.length * 2);
    for (let i = 0; i < g.ring.length; i++) {
      const [x, y] = g.xy[i];
      const { p, n, t } = surfaceFrame('torus', x + 0.5, y + 0.5, g.width, g.height, flow);
      const c = chartCellCenter(x, y, g.width, g.height, cell);
      out.chart2d[i * 2] = c[0];
      out.chart2d[i * 2 + 1] = c[2];
      writeFrameExt(out, i, { p, s: 1, n, t, chi: 1 });
    }
    fillPortals(g, out, at);
    buildTorusSurfaceEdgePaths(g, out, flow);
  }
  if (chart) {
    buildEdgePaths(g, out, (a, b) => {
      const pa = at(a), pb = at(b);
      return { pa, pb, na: [0, 1, 0] as Tuple3, nb: [0, 1, 0] as Tuple3 };
    });
  }
  bumpRev(out);
  return out;
}

/** C4: Klein fundamental square (canonical) or flat chart for immersion pick-back. */
/** Bonus: Fig-8 Klein bottle immersion (self-intersection drawn, not adjacency). */
export function embedKleinImmersion(g: SurfaceGraph, out: Embedding, params: KleinEmbedParams = {}): Embedding {
  const cell = params.cell ?? chartCell(g.width, g.height);
  const flow = params.flow ?? NO_FLOW;
  const flat: [number, number][] = g.xy.map(([x, y]) => {
    const { p } = surfaceFrame('klein', x + 0.5, y + 0.5, g.width, g.height, flow);
    return [p[0], p[2]];
  });
  out.pitch = medianEdgePitch(g, flat);
  out.chart2d = new Float32Array(g.ring.length * 2);
  const at = (i: number): Tuple3 => {
    const [x, y] = g.xy[i];
    return surfaceFrame('klein', x + 0.5, y + 0.5, g.width, g.height, flow).p;
  };
  for (let i = 0; i < g.ring.length; i++) {
    const [x, y] = g.xy[i];
    const { p, n, t } = surfaceFrame('klein', x + 0.5, y + 0.5, g.width, g.height, flow);
    const c = chartCellCenter(x, y, g.width, g.height, cell);
    out.chart2d[i * 2] = c[0];
    out.chart2d[i * 2 + 1] = c[2];
    writeFrameExt(out, i, { p, s: 1, n, t, chi: 1 });
  }
  fillPortals(g, out, at);
  buildKleinSurfaceEdgePaths(g, out, flow);
  bumpRev(out);
  return out;
}

export function embedKlein(g: SurfaceGraph, out: Embedding, params: KleinEmbedParams = {}): Embedding {
  const cell = params.cell ?? chartCell(g.width, g.height);
  const xy = g.xy.map(([x, y]) => {
    const c = chartCellCenter(x, y, g.width, g.height, cell);
    return [c[0], c[2]] as [number, number];
  });
  out.pitch = medianEdgePitch(g, xy);
  out.chart2d = new Float32Array(g.ring.length * 2);
  const chiMap = new Int8Array(g.ring.length).fill(1);
  for (let i = 0; i < g.ring.length; i++) {
    for (const j of g.neighbours[i]) {
      if (j < i) continue;
      if (g.flipEdge(i, j)) transportChirality(chiMap, i, j, true);
    }
  }
  const at = (i: number): Tuple3 => {
    const [x, y] = g.xy[i];
    return chartCellCenter(x, y, g.width, g.height, cell);
  };
  for (let i = 0; i < g.ring.length; i++) {
    const f = at(i);
    out.chart2d[i * 2] = f[0];
    out.chart2d[i * 2 + 1] = f[2];
    const chi = chiMap[i];
    const t: Tuple3 = chi < 0 ? [-1, 0, 0] : [1, 0, 0];
    writeFrameExt(out, i, { p: f, s: 1, n: [0, 1, 0], t, chi });
  }
  fillPortals(g, out, at);
  buildEdgePaths(g, out, (a, b) => ({ pa: at(a), pb: at(b), na: [0, 1, 0], nb: [0, 1, 0] }));
  bumpRev(out);
  return out;
}

export function makeEmbedding(count: number): Embedding {
  return createEmbedding(count);
}
