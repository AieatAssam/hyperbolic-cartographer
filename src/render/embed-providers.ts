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
  KLEIN_SCALE, TORUS_R, TORUS_r, chartCell, chartOffset, kleinImmersionFrame, torusNormal, torusPos, torusTangent,
} from './surface-params';

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
}

export interface KleinEmbedParams {
  chart?: boolean;
  cell?: number;
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
  const R = params.majorR ?? TORUS_R();
  const r = params.minorR ?? TORUS_r();
  const chart = params.chart ?? false;
  const cell = chartCell(g.width, g.height);
  const [ox, , oz] = chartOffset(g.width, g.height, cell);
  const at = (i: number): Tuple3 => {
    const [x, y] = g.xy[i];
    return chart
      ? [x * cell + ox, 0, y * cell + oz]
      : torusPos(x, y, g.width, g.height, R, r);
  };
  if (chart) {
    const xy = g.xy.map(([x, y]) => [x * cell + ox, y * cell + oz] as [number, number]);
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
      const p = torusPos(x, y, g.width, g.height, R, r);
      return [p[0], p[2]];
    });
    out.pitch = medianEdgePitch(g, flat, g.ring.map(() => 1));
    out.chart2d = new Float32Array(g.ring.length * 2);
    for (let i = 0; i < g.ring.length; i++) {
      const [x, y] = g.xy[i];
      const p = torusPos(x, y, g.width, g.height, R, r);
      const n = torusNormal(x, y, g.width, g.height);
      const t = torusTangent(n);
      out.chart2d[i * 2] = x * cell;
      out.chart2d[i * 2 + 1] = y * cell;
      writeFrameExt(out, i, { p, s: 1, n, t, chi: 1 });
    }
    fillPortals(g, out, at);
  }
  buildEdgePaths(g, out, (a, b) => {
    const pa = at(a), pb = at(b);
    const na = chart ? ([0, 1, 0] as Tuple3) : torusNormal(g.xy[a][0], g.xy[a][1], g.width, g.height);
    const nb = chart ? ([0, 1, 0] as Tuple3) : torusNormal(g.xy[b][0], g.xy[b][1], g.width, g.height);
    return { pa, pb, na, nb };
  });
  bumpRev(out);
  return out;
}

/** C4: Klein fundamental square (canonical) or flat chart for immersion pick-back. */
/** Bonus: Fig-8 Klein bottle immersion (self-intersection drawn, not adjacency). */
export function embedKleinImmersion(g: SurfaceGraph, out: Embedding, params: KleinEmbedParams = {}): Embedding {
  const cell = params.cell ?? chartCell(g.width, g.height);
  const scale = KLEIN_SCALE();
  const flat: [number, number][] = g.xy.map(([x, y]) => {
    const u = (x / g.width) * Math.PI * 2;
    const v = (y / g.height) * Math.PI * 2;
    const fr = kleinImmersionFrame(u, v, scale);
    return [fr.p[0], fr.p[2]];
  });
  out.pitch = medianEdgePitch(g, flat);
  out.chart2d = new Float32Array(g.ring.length * 2);
  const at = (i: number): Tuple3 => {
    const [x, y] = g.xy[i];
    const u = (x / g.width) * Math.PI * 2;
    const v = (y / g.height) * Math.PI * 2;
    return kleinImmersionFrame(u, v, scale).p;
  };
  for (let i = 0; i < g.ring.length; i++) {
    const [x, y] = g.xy[i];
    const u = (x / g.width) * Math.PI * 2;
    const v = (y / g.height) * Math.PI * 2;
    const { p, n, t } = kleinImmersionFrame(u, v, scale);
    out.chart2d[i * 2] = x * cell;
    out.chart2d[i * 2 + 1] = y * cell;
    writeFrameExt(out, i, { p, s: 1, n, t, chi: 1 });
  }
  fillPortals(g, out, at);
  buildEdgePaths(g, out, (a, b) => {
    const fa = framePos(out, a), fb = framePos(out, b);
    return { pa: fa.p, pb: fb.p, na: fa.n, nb: fb.n };
  });
  bumpRev(out);
  return out;
}

const framePos = (e: Embedding, i: number) => {
  const o = i * 12;
  return {
    p: [e.data[o], e.data[o + 1], e.data[o + 2]] as Tuple3,
    n: [e.data[o + 4], e.data[o + 5], e.data[o + 6]] as Tuple3,
  };
};

export function embedKlein(g: SurfaceGraph, out: Embedding, params: KleinEmbedParams = {}): Embedding {
  const cell = params.cell ?? chartCell(g.width, g.height);
  const [ox, , oz] = chartOffset(g.width, g.height, cell);
  const xy = g.xy.map(([x, y]) => [x * cell + ox, y * cell + oz] as [number, number]);
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
    return [x * cell + ox, 0, y * cell + oz];
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
