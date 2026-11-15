/**
 * One shape function for every closed-surface stage: the flat chart (morph 0), the 3D surface (morph 1) and every
 * frame of the fold between them. Allocation-free: results are written into caller-owned arrays.
 *
 * Grid coords: continuous (gx, gy) in cell units, cell (x, y) centred at (x + 0.5, y + 0.5).
 * Frame convention: on the chart +gx is +X and +gy is +Z, so the tile normal cross(∂P/∂gy, ∂P/∂gx) is +Y. At morph 1
 * the same cross product points out of the torus and to the "front" face of the Möbius band.
 */
import type { Surface } from '../core/state';
import { config } from '../core/config';
import { kleinBottleRaw, kleinImmersionPos, kleinParam } from './klein-bottle';
import { chartCell } from './surface-params';

const TAU = Math.PI * 2;

/** Klein u at equal arc-length steps (same nodes as klein-bottle's private table), so the hot path never allocates. */
const ARC_N = 256;
const ARC = new Float64Array(ARC_N + 1);
for (let k = 0; k <= ARC_N; k++) ARC[k] = k === ARC_N ? Math.PI : kleinParam(k / ARC_N, 0, 1, 1)[0];
let kleinC = [NaN, 0, 0, 0]; // [scale, cx, cy, cz]

/** Height of the arc the tiles fly along during the fold. */
export const FOLD_LIFT = 2.4;

/** Writes the 3D surface point (morph 1) at continuous grid coords into out[o..o+2]. */
export function target3d(surf: Surface, gx: number, gy: number, w: number, h: number, out: Float64Array | number[], o = 0) {
  const m = config.manifold;
  if (surf === 'torus') {
    const u = Math.PI / 2 - TAU * (gx / w - 0.5), v = Math.PI / 2 - TAU * (gy / h - 0.5);
    const rho = m.torusMajorR + m.torusMinorR * Math.cos(v);
    out[o] = rho * Math.cos(u); out[o + 1] = m.torusMinorR * Math.sin(v); out[o + 2] = rho * Math.sin(u);
    return;
  }
  if (surf === 'mobius') {
    // P(u + 2π, s) = P(u, −s): one lap along the band lands on the mirrored row, two laps come home.
    const u = Math.PI / 2 - TAU * (gx / w - 0.5), s = (gy / h - 0.5) * 2 * m.mobiusHalfWidth;
    const c = Math.cos(u / 2), rho = m.mobiusMajorR + s * c;
    out[o] = rho * Math.cos(u); out[o + 1] = s * Math.sin(u / 2); out[o + 2] = rho * Math.sin(u);
    return;
  }
  // Klein: the double cover along x glide-reflects y (same as kleinParam).
  const k = Math.floor(gx / w);
  let y = gy;
  if (k & 1) y = h - y;
  const f = (gx / w - k) * ARC_N, i = Math.min(ARC_N - 1, Math.max(0, Math.floor(f)));
  const u = ARC[i] + (ARC[i + 1] - ARC[i]) * (f - i), v = (y / h) * TAU + Math.PI / 2;
  const sc = m.kleinImmersionScale;
  if (kleinC[0] !== sc) {
    const raw = kleinBottleRaw(0, 0), p = kleinImmersionPos(0, 0, sc);
    kleinC = [sc, raw[0] * sc - p[0], raw[1] * sc - p[1], raw[2] * sc - p[2]];
  }
  // kleinBottleRaw inlined (it returns a tuple)
  const cu = Math.cos(u), su = Math.sin(u), cv = Math.cos(v), sv = Math.sin(v);
  const c2 = cu * cu, c4 = c2 * c2, c6 = c4 * c2;
  const x = (-2 / 15) * cu * (3 * cv - 30 * su + 90 * c4 * su - 60 * c6 * su + 5 * cu * cv * su);
  const yy = (-1 / 15) * su * (3 * cv - 3 * c2 * cv - 48 * c4 * cv + 48 * c6 * cv - 60 * su
    + 5 * cu * cv * su - 5 * c2 * cu * cv * su - 80 * c4 * cu * cv * su + 80 * c6 * cu * cv * su);
  const z = (2 / 15) * (3 + 5 * cu * su) * sv;
  out[o] = x * sc - kleinC[1]; out[o + 1] = yy * sc - kleinC[2]; out[o + 2] = z * sc - kleinC[3];
}

/** Chart cell size used by the flat view of this surface. */
export const shapeCell = (w: number, h: number) => chartCell(w, h);

/**
 * Point at grid coords for fold progress e (0 chart, 1 surface): a straight blend lifted along an arc, so tiles
 * rise off the map, fly and settle onto the surface.
 */
export function shapePos(
  surf: Surface, gx: number, gy: number, w: number, h: number, e: number, out: Float64Array | number[], o = 0,
) {
  const cell = chartCell(w, h);
  const cx = (gx - w / 2) * cell, cz = (gy - h / 2) * cell;
  if (e <= 0) { out[o] = cx; out[o + 1] = 0; out[o + 2] = cz; return; }
  target3d(surf, gx, gy, w, h, out, o);
  if (e >= 1) return;
  out[o] = cx + (out[o] - cx) * e;
  out[o + 1] = out[o + 1] * e + Math.sin(Math.PI * e) * FOLD_LIFT;
  out[o + 2] = cz + (out[o + 2] - cz) * e;
}

const FA = new Float64Array(12);
/**
 * Point and unit normal (cross(∂P/∂gy, ∂P/∂gx), central differences) at grid coords: out = [px, py, pz, nx, ny, nz,
 * tx, ty, tz] where t is the unit +gx tangent.
 */
export function shapeFrame(
  surf: Surface, gx: number, gy: number, w: number, h: number, e: number, out: Float64Array | number[],
) {
  const d = 1e-3;
  shapePos(surf, gx, gy, w, h, e, out, 0);
  shapePos(surf, gx + d, gy, w, h, e, FA, 0);
  shapePos(surf, gx - d, gy, w, h, e, FA, 3);
  shapePos(surf, gx, gy + d, w, h, e, FA, 6);
  shapePos(surf, gx, gy - d, w, h, e, FA, 9);
  const ux = FA[0] - FA[3], uy = FA[1] - FA[4], uz = FA[2] - FA[5];
  const vx = FA[6] - FA[9], vy = FA[7] - FA[10], vz = FA[8] - FA[11];
  let nx = vy * uz - vz * uy, ny = vz * ux - vx * uz, nz = vx * uy - vy * ux;
  const L = Math.hypot(nx, ny, nz) || 1, Lu = Math.hypot(ux, uy, uz) || 1;
  nx /= L; ny /= L; nz /= L;
  out[3] = nx; out[4] = ny; out[5] = nz;
  out[6] = ux / Lu; out[7] = uy / Lu; out[8] = uz / Lu;
}

/** Per-cell fold progress: the middle of the chart leads, the edges follow (d = 0 centre .. 1 edge). */
export function foldEase(m: number, d: number) {
  const t = Math.min(1, Math.max(0, m * 1.6 - d * 0.6));
  return t * t * (3 - 2 * t);
}

/** Flow period in turns along x: Möbius and Klein need two laps to come home (one lap mirrors the tile). */
export const flowPeriodU = (surf: Surface) => (surf === 'torus' ? 1 : 2);
/** Only the torus flows along y; y-shifts tear the glide on the Möbius strip and Klein bottle. */
export const flowsV = (surf: Surface) => surf === 'torus';

/**
 * Where cell centre (cx, cy) is drawn after flowing by (fu, fv) turns, wrapped into the fundamental chart.
 * Writes [gx, gy] to out and returns 1 when the tile crossed the flip seam an odd number of times (drawn mirrored).
 */
export function flowCell(surf: Surface, cx: number, cy: number, w: number, h: number, fu: number, fv: number, out: number[] | Float64Array): number {
  let x = cx + fu * w;
  const laps = Math.floor(x / w);
  x -= laps * w;
  let y = cy;
  if (surf === 'torus') {
    y += fv * h;
    y -= Math.floor(y / h) * h;
    out[0] = x; out[1] = y;
    return 0;
  }
  const odd = laps & 1;
  if (odd) y = h - y;
  out[0] = x; out[1] = y;
  return odd;
}

/** Bounding radius of the 3D surface (for picking prefilter, camera limits and the stage plinth). */
export function shapeRadius(surf: Surface): number {
  const m = config.manifold;
  if (surf === 'torus') return m.torusMajorR + m.torusMinorR;
  if (surf === 'mobius') return m.mobiusMajorR + m.mobiusHalfWidth;
  return m.kleinImmersionScale * 2.2;
}
