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

export const DISK_R = 9;
const GAP = 0.9;

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

const torusPos = (x: number, y: number, w: number, h: number, R: number, r: number): Tuple3 => {
  const u = (x / w) * Math.PI * 2;
  const v = (y / h) * Math.PI * 2;
  const cx = (R + r * Math.cos(v)) * Math.cos(u);
  const cz = (R + r * Math.cos(v)) * Math.sin(u);
  const cy = r * Math.sin(v);
  return [cx, cy, cz];
};

const torusNormal = (x: number, y: number, w: number, h: number): Tuple3 => {
  const u = (x / w) * Math.PI * 2;
  const v = (y / h) * Math.PI * 2;
  const nx = Math.cos(v) * Math.cos(u);
  const ny = Math.sin(v);
  const nz = Math.cos(v) * Math.sin(u);
  const L = Math.hypot(nx, ny, nz);
  return [nx / L, ny / L, nz / L];
};

const torusTangent = (n: Tuple3): [Tuple3, 1] => {
  const ref: Tuple3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const tx = ref[1] * n[2] - ref[2] * n[1];
  const ty = ref[2] * n[0] - ref[0] * n[2];
  const tz = ref[0] * n[1] - ref[1] * n[0];
  const L = Math.hypot(tx, ty, tz);
  return L > 1e-9 ? [[tx / L, ty / L, tz / L], 1] : [[1, 0, 0], 1];
};

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
  const R = params.majorR ?? 5;
  const r = params.minorR ?? 1.8;
  const chart = params.chart ?? false;
  const gap = GAP * (chart ? 0.85 : 0.3);
  if (chart) {
    const xy = g.xy.map(([x, y]) => [x * gap, y * gap] as [number, number]);
    out.pitch = medianEdgePitch(g, xy);
    out.seam = (a, b) => g.seamEdge(a, b);
    out.chart2d = new Float32Array(g.ring.length * 2);
    for (let i = 0; i < g.ring.length; i++) {
      const [x, y] = g.xy[i];
      out.chart2d[i * 2] = x * gap;
      out.chart2d[i * 2 + 1] = y * gap;
      writeFrameExt(out, i, { p: [x * gap, 0, y * gap], s: 1, n: [0, 1, 0], t: [1, 0, 0], chi: 1 });
    }
  } else {
    const flat: [number, number][] = g.xy.map(([x, y]) => {
      const p = torusPos(x, y, g.width, g.height, R, r);
      return [p[0], p[2]];
    });
    out.pitch = medianEdgePitch(g, flat, g.ring.map(() => 1));
    delete out.seam;
    out.chart2d = new Float32Array(g.ring.length * 2);
    for (let i = 0; i < g.ring.length; i++) {
      const [x, y] = g.xy[i];
      const p = torusPos(x, y, g.width, g.height, R, r);
      const n = torusNormal(x, y, g.width, g.height);
      const [t, chi] = torusTangent(n);
      out.chart2d[i * 2] = x * GAP;
      out.chart2d[i * 2 + 1] = y * GAP;
      writeFrameExt(out, i, { p, s: 1, n, t, chi });
    }
  }
  buildEdgePaths(g, out, (a, b) => {
    if (chart) {
      const pa: Tuple3 = [g.xy[a][0] * gap, 0, g.xy[a][1] * gap];
      const pb: Tuple3 = [g.xy[b][0] * gap, 0, g.xy[b][1] * gap];
      return { pa, pb, na: [0, 1, 0], nb: [0, 1, 0] };
    }
    const [xa, ya] = g.xy[a], [xb, yb] = g.xy[b];
    const pa = torusPos(xa, ya, g.width, g.height, R, r);
    const pb = torusPos(xb, yb, g.width, g.height, R, r);
    const na = torusNormal(xa, ya, g.width, g.height);
    const nb = torusNormal(xb, yb, g.width, g.height);
    return { pa, pb, na, nb };
  });
  bumpRev(out);
  return out;
}

/** C4: Klein fundamental square (canonical) or flat chart for immersion pick-back. */
/** Bonus: Fig-8 Klein bottle immersion (self-intersection drawn, not adjacency). */
export function embedKleinImmersion(g: SurfaceGraph, out: Embedding, params: KleinEmbedParams = {}): Embedding {
  const cell = params.cell ?? GAP * 0.5;
  const scale = 2.2;
  const flat: [number, number][] = g.xy.map(([x, y]) => {
    const u = (x / g.width) * Math.PI * 2;
    const v = (y / g.height) * Math.PI * 2;
    const cx = scale * (Math.cos(u / 2) * Math.sin(v) - Math.sin(u / 2) * Math.sin(2 * v));
    const cz = scale * (Math.sin(u / 2) * Math.sin(v) + Math.cos(u / 2) * Math.sin(2 * v));
    return [cx, cz];
  });
  out.pitch = medianEdgePitch(g, flat);
  delete out.seam;
  out.chart2d = new Float32Array(g.ring.length * 2);
  for (let i = 0; i < g.ring.length; i++) {
    const [x, y] = g.xy[i];
    const u = (x / g.width) * Math.PI * 2;
    const v = (y / g.height) * Math.PI * 2;
    const px = scale * (Math.cos(u / 2) * Math.sin(v) - Math.sin(u / 2) * Math.sin(2 * v));
    const py = scale * Math.sin(u / 2) * Math.cos(v) * 2;
    const pz = scale * (Math.sin(u / 2) * Math.sin(v) + Math.cos(u / 2) * Math.sin(2 * v));
    out.chart2d[i * 2] = x * cell;
    out.chart2d[i * 2 + 1] = y * cell;
    writeFrameExt(out, i, { p: [px, py, pz], s: 1, n: [0, 1, 0], t: [1, 0, 0], chi: 1 });
  }
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
  const gap = GAP * 0.85;
  const cell = params.cell ?? gap;
  out.pitch = medianEdgePitch(g, g.xy.map(([x, y]) => [x * cell, y * cell]));
  out.seam = (a, b) => g.seamEdge(a, b);
  out.chart2d = new Float32Array(g.ring.length * 2);
  const chiMap = new Int8Array(g.ring.length).fill(1);
  for (let i = 0; i < g.ring.length; i++) chiMap[i] = 1;
  for (let i = 0; i < g.ring.length; i++) {
    for (const j of g.neighbours[i]) {
      if (j < i) continue;
      if (g.flipEdge(i, j)) transportChirality(chiMap, i, j, true);
    }
  }
  for (let i = 0; i < g.ring.length; i++) {
    const [x, y] = g.xy[i];
    out.chart2d[i * 2] = x * cell;
    out.chart2d[i * 2 + 1] = y * cell;
    const chi = chiMap[i];
    const t: Tuple3 = chi < 0 ? [-1, 0, 0] : [1, 0, 0];
    writeFrameExt(out, i, { p: [x * cell, 0, y * cell], s: 1, n: [0, 1, 0], t, chi });
  }
  if (out.portals) out.portals.length = 0;
  else out.portals = [];
  g.neighbours.forEach((ns, a) => {
    for (const b of ns) {
      if (b <= a || !g.seamEdge(a, b)) continue;
      const pa = [g.xy[a][0] * cell, 0, g.xy[a][1] * cell] as Tuple3;
      const pb = [g.xy[b][0] * cell, 0, g.xy[b][1] * cell] as Tuple3;
      const flip = g.flipEdge(a, b);
      out.portals!.push({ a, b, portA: pa, portB: pb, flip });
    }
  });
  buildEdgePaths(g, out, (a, b) => {
    const pa: Tuple3 = [g.xy[a][0] * cell, 0, g.xy[a][1] * cell];
    const pb: Tuple3 = [g.xy[b][0] * cell, 0, g.xy[b][1] * cell];
    return { pa, pb, na: [0, 1, 0], nb: [0, 1, 0] };
  });
  bumpRev(out);
  return out;
}

export function makeEmbedding(count: number): Embedding {
  return createEmbedding(count);
}
